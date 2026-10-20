import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createHousehold, createUser, pool, sqlState } from './helpers';

afterAll(async () => {
  await pool.end();
});

describe('perfis', () => {
  it('cria o perfil automaticamente ao criar o usuário', async () => {
    const id = await createUser();
    const { rows } = await pool.query('select id, timezone, version from public.profiles where id = $1', [id]);
    expect(rows).toEqual([{ id, timezone: 'America/Sao_Paulo', version: 1 }]);
  });

  it('usuário vê o próprio perfil e não vê o de estranhos', async () => {
    const a = await createUser();
    const b = await createUser();
    const ids = await asUser(a, async (db) => (await db.query('select id from public.profiles')).rows.map((r) => r.id));
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
  });

  it('usuário só altera colunas permitidas do próprio perfil', async () => {
    const a = await createUser();
    const b = await createUser();
    await asUser(a, (db) => db.query("update public.profiles set display_name = 'Ana' where id = $1", [a]));
    const { rows } = await pool.query('select display_name, version from public.profiles where id = $1', [a]);
    expect(rows[0]).toEqual({ display_name: 'Ana', version: 2 });

    // Perfil alheio: RLS filtra, nenhuma linha é afetada.
    const affected = await asUser(a, async (db) =>
      (await db.query("update public.profiles set display_name = 'Invasor' where id = $1", [b])).rowCount,
    );
    expect(affected).toBe(0);

    // Coluna não concedida (id/version) é recusada.
    expect(await sqlState(asUser(a, (db) => db.query('update public.profiles set version = 99 where id = $1', [a])))).toBe('42501');
  });

  it('rejeita fuso horário inválido', async () => {
    const a = await createUser();
    expect(
      await sqlState(asUser(a, (db) => db.query("update public.profiles set timezone = 'Marte/Base' where id = $1", [a]))),
    ).toBe('23514');
  });
});

describe('acesso anônimo', () => {
  it.each(['profiles', 'households', 'household_members'])('anon não lê public.%s', async (table) => {
    expect(await sqlState(asAnon((db) => db.query(`select * from public.${table}`)))).toBe('42501');
  });

  it('anon não executa create_household', async () => {
    expect(
      await sqlState(asAnon((db) => db.query("select public.create_household('X', 'family', $1)", [randomUUID()]))),
    ).toBe('42501');
  });

  it('anon não acessa o esquema privado', async () => {
    expect(await sqlState(asAnon((db) => db.query('select * from app_private.audit_events')))).toBe('42501');
  });
});

describe('create_household', () => {
  it('cria o espaço e torna o criador owner, de forma transacional', async () => {
    const a = await createUser();
    const h = await createHousehold(a, '  Casa  ');
    expect(h.name).toBe('Casa');
    const { rows } = await pool.query('select user_id, role from public.household_members where household_id = $1', [h.id]);
    expect(rows).toEqual([{ user_id: a, role: 'owner' }]);
    const audit = await pool.query('select action, actor_id from app_private.audit_events where entity_id = $1', [h.id]);
    expect(audit.rows).toEqual([{ action: 'household.created', actor_id: a }]);
  });

  it('exige usuário autenticado', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      expect(await sqlState(client.query("select public.create_household('X', 'family', $1)", [randomUUID()]))).toBe('42501');
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it.each([
    ['', '23514'],
    ['   ', '23514'],
    ['x'.repeat(81), '23514'],
  ])('rejeita nome inválido %#', async (name, code) => {
    const a = await createUser();
    expect(await sqlState(createHousehold(a, name))).toBe(code);
  });

  it('rejeita fuso inválido e chave nula', async () => {
    const a = await createUser();
    expect(
      await sqlState(asUser(a, (db) => db.query("select public.create_household('X', 'family', $1, 'Marte/Base')", [randomUUID()]))),
    ).toBe('22023');
    expect(await sqlState(asUser(a, (db) => db.query("select public.create_household('X', 'family', null)")))).toBe('22023');
  });

  it('é idempotente: mesma chave devolve o mesmo espaço sem duplicar', async () => {
    const a = await createUser();
    const key = randomUUID();
    const first = await createHousehold(a, 'Casa', 'family', key);
    const second = await createHousehold(a, 'Casa', 'family', key);
    expect(second.id).toBe(first.id);
    const { rows } = await pool.query('select count(*)::int as n from public.households where created_by = $1', [a]);
    expect(rows[0].n).toBe(1);
  });

  it('recusa reutilizar a chave com parâmetros diferentes', async () => {
    const a = await createUser();
    const key = randomUUID();
    await createHousehold(a, 'Casa', 'family', key);
    expect(await sqlState(createHousehold(a, 'Outra', 'family', key))).toBe('23505');
  });

  it('não duplica com requisições concorrentes usando a mesma chave', async () => {
    const a = await createUser();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => createHousehold(a, 'Concorrente', 'family', key)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const { rows } = await pool.query('select count(*)::int as n from public.households where created_by = $1', [a]);
    expect(rows[0].n).toBe(1);
  });

  it('a mesma chave usada por usuários diferentes não colide', async () => {
    const a = await createUser();
    const b = await createUser();
    const key = randomUUID();
    const ha = await createHousehold(a, 'Casa', 'family', key);
    const hb = await createHousehold(b, 'Casa', 'family', key);
    expect(ha.id).not.toBe(hb.id);
  });
});

describe('isolamento entre espaços (RLS)', () => {
  it('membro vê o próprio espaço; estranho não vê espaço nem membros', async () => {
    const a = await createUser();
    const b = await createUser();
    const h = await createHousehold(a, 'Privado');

    const seenByA = await asUser(a, async (db) => (await db.query('select id from public.households')).rows);
    expect(seenByA.map((r) => r.id)).toContain(h.id);

    const seenByB = await asUser(b, async (db) => (await db.query('select id from public.households where id = $1', [h.id])).rows);
    expect(seenByB).toEqual([]);
    const membersByB = await asUser(b, async (db) =>
      (await db.query('select * from public.household_members where household_id = $1', [h.id])).rows,
    );
    expect(membersByB).toEqual([]);
  });

  it('autenticado não insere nem exclui diretamente nas tabelas', async () => {
    const a = await createUser();
    const h = await createHousehold(a);
    expect(
      await sqlState(asUser(a, (db) => db.query("insert into public.households (name, kind, created_by) values ('X', 'family', $1)", [a]))),
    ).toBe('42501');
    expect(
      await sqlState(asUser(a, (db) => db.query("insert into public.household_members values ($1, $2, 'owner')", [h.id, a]))),
    ).toBe('42501');
    expect(await sqlState(asUser(a, (db) => db.query('delete from public.households where id = $1', [h.id])))).toBe('42501');
    expect(
      await sqlState(asUser(a, (db) => db.query("update public.household_members set role = 'viewer' where household_id = $1", [h.id]))),
    ).toBe('42501');
  });

  it('owner renomeia; viewer e member não; versão incrementa (concorrência otimista)', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const member = await createUser();
    const h = await createHousehold(owner, 'Família');
    // Inclusão de membros ainda não tem fluxo (fase futura): inserida como superusuário só para o teste.
    await pool.query(
      "insert into public.household_members (household_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'member')",
      [h.id, viewer, member],
    );

    for (const who of [viewer, member]) {
      const n = await asUser(who, async (db) =>
        (await db.query("update public.households set name = 'Hackeado' where id = $1", [h.id])).rowCount,
      );
      expect(n).toBe(0);
    }

    const updated = await asUser(owner, async (db) =>
      (await db.query("update public.households set name = 'Família Silva' where id = $1 and version = $2 returning version", [h.id, h.version])).rows,
    );
    expect(updated).toEqual([{ version: h.version + 1 }]);

    // Atualização com versão antiga não afeta linhas: conflito detectável.
    const stale = await asUser(owner, async (db) =>
      (await db.query("update public.households set name = 'Outro' where id = $1 and version = $2", [h.id, h.version])).rowCount,
    );
    expect(stale).toBe(0);

    // Viewer agora vê o espaço e o perfil dos co-membros.
    const profilesSeen = await asUser(viewer, async (db) => (await db.query('select id from public.profiles')).rows.map((r) => r.id));
    expect(profilesSeen).toEqual(expect.arrayContaining([owner, viewer, member]));
  });

  it('owner não altera colunas protegidas (kind, created_by)', async () => {
    const a = await createUser();
    const h = await createHousehold(a);
    expect(await sqlState(asUser(a, (db) => db.query("update public.households set kind = 'personal' where id = $1", [h.id])))).toBe('42501');
    expect(await sqlState(asUser(a, (db) => db.query('update public.households set created_by = $2 where id = $1', [h.id, a])))).toBe('42501');
  });

  it('espaço pessoal não admite segundo membro', async () => {
    const a = await createUser();
    const b = await createUser();
    const h = await createHousehold(a, 'Pessoal', 'personal');
    expect(
      await sqlState(pool.query("insert into public.household_members (household_id, user_id, role) values ($1, $2, 'viewer')", [h.id, b])),
    ).toBe('23514');
  });
});

describe('auditoria', () => {
  it('eventos são somente inclusão, inclusive para o dono do banco', async () => {
    const a = await createUser();
    await createHousehold(a);
    expect(await sqlState(pool.query("update app_private.audit_events set action = 'x.y'"))).toBe('42501');
    expect(await sqlState(pool.query('delete from app_private.audit_events'))).toBe('42501');
    expect(await sqlState(pool.query('truncate app_private.audit_events'))).toBe('42501');
  });

  it('autenticado não lê a auditoria diretamente', async () => {
    const a = await createUser();
    expect(await sqlState(asUser(a, (db) => db.query('select * from app_private.audit_events')))).toBe('42501');
  });
});

describe('convenções de esquema', () => {
  it('nenhuma coluna usa ponto flutuante', async () => {
    const { rows } = await pool.query(`
      select table_schema, table_name, column_name
      from information_schema.columns
      where table_schema in ('public', 'app_private')
        and data_type in ('real', 'double precision')`);
    expect(rows).toEqual([]);
  });

  it('todas as tabelas de public têm RLS habilitado', async () => {
    const { rows } = await pool.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('funções security definer fixam search_path', async () => {
    const { rows } = await pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });

  it('anon não executa nenhuma função de public nem acessa nenhuma tabela', async () => {
    const funcs = await pool.query(`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(funcs.rows).toEqual([]);
    const tables = await pool.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
        and has_table_privilege('anon', c.oid, 'select, insert, update, delete')`);
    expect(tables.rows).toEqual([]);
  });

  it('authenticated não tem INSERT/DELETE direto em nenhuma tabela de public', async () => {
    const { rows } = await pool.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and has_table_privilege('authenticated', c.oid, 'insert, delete, truncate')`);
    expect(rows).toEqual([]);
  });

  it('money_cents é bigint (inteiro em centavos)', async () => {
    const { rows } = await pool.query(`
      select format_type(t.typbasetype, null) as base from pg_type t
      join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'money_cents'`);
    expect(rows).toEqual([{ base: 'bigint' }]);
  });
});
