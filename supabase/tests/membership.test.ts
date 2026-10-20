import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, createHousehold, createUser, pool, sqlState } from './helpers';

afterAll(async () => {
  await pool.end();
});

interface Family {
  id: string;
  owner: string;
  admin: string;
  member: string;
  viewer: string;
}

/** Espaço familiar com os quatro papéis. Inclusão de membros ainda não tem RPC (fase de compartilhamento). */
async function family(): Promise<Family> {
  const [owner, admin, member, viewer] = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
  const h = await createHousehold(owner, 'Família', 'family');
  await pool.query(
    `insert into public.household_members (household_id, user_id, role)
     values ($1, $2, 'admin'), ($1, $3, 'member'), ($1, $4, 'viewer')`,
    [h.id, admin, member, viewer],
  );
  return { id: h.id, owner, admin, member, viewer };
}

const remove = (actor: string, householdId: string, target: string) =>
  asUser(actor, (db) => db.query('select public.remove_household_member($1, $2)', [householdId, target]));

const visibleHouseholds = (user: string) =>
  asUser(user, async (db) => (await db.query('select id from public.households')).rows.map((r) => r.id as string));

const roles = async (householdId: string) =>
  Object.fromEntries(
    (await pool.query('select user_id, role from public.household_members where household_id = $1', [householdId])).rows.map(
      (r) => [r.user_id, r.role],
    ),
  );

describe('D04 — dados privados não são acessíveis pela administração familiar', () => {
  let f: Family;
  beforeEach(async () => {
    f = await family();
  });

  it.each(['owner', 'admin', 'member', 'viewer'] as const)('%s da família não vê o espaço pessoal de outro membro', async (who) => {
    const other = who === 'viewer' ? f.member : f.viewer;
    const personal = await createHousehold(other, 'Pessoal', 'personal');
    expect(await visibleHouseholds(f[who])).not.toContain(personal.id);
    const members = await asUser(f[who], async (db) =>
      (await db.query('select * from public.household_members where household_id = $1', [personal.id])).rows,
    );
    expect(members).toEqual([]);
    const updated = await asUser(f[who], async (db) =>
      (await db.query("update public.households set name = 'X' where id = $1", [personal.id])).rowCount,
    );
    expect(updated).toBe(0);
  });

  it('owner da família não remove o dono de um espaço pessoal alheio', async () => {
    const personal = await createHousehold(f.member, 'Pessoal', 'personal');
    expect(await sqlState(remove(f.owner, personal.id, f.member))).toBe('42501');
  });

  it('o próprio usuário continua vendo seu espaço pessoal', async () => {
    const personal = await createHousehold(f.member, 'Pessoal', 'personal');
    expect(await visibleHouseholds(f.member)).toEqual(expect.arrayContaining([personal.id, f.id]));
  });
});

describe('D05 — remoção de membros por papel', () => {
  let f: Family;
  beforeEach(async () => {
    f = await family();
  });

  it.each([
    ['owner', 'admin'],
    ['owner', 'member'],
    ['owner', 'viewer'],
    ['admin', 'member'],
    ['admin', 'viewer'],
  ] as const)('%s pode remover %s', async (actor, target) => {
    await remove(f[actor], f.id, f[target]);
    expect((await roles(f.id))[f[target]]).toBeUndefined();
  });

  it.each([
    ['admin', 'owner'],
    ['member', 'viewer'],
    ['member', 'owner'],
    ['viewer', 'member'],
    ['viewer', 'admin'],
  ] as const)('%s não pode remover %s', async (actor, target) => {
    expect(await sqlState(remove(f[actor], f.id, f[target]))).toBe('42501');
    expect((await roles(f.id))[f[target]]).toBe(target);
  });

  it('admin não remove outro admin', async () => {
    const admin2 = await createUser();
    await pool.query("insert into public.household_members values ($1, $2, 'admin')", [f.id, admin2]);
    expect(await sqlState(remove(f.admin, f.id, admin2))).toBe('42501');
  });

  it.each(['admin', 'member', 'viewer'] as const)('%s pode sair do espaço', async (who) => {
    await remove(f[who], f.id, f[who]);
    expect((await roles(f.id))[f[who]]).toBeUndefined();
  });

  it('owner não pode sair (não há transferência de propriedade)', async () => {
    expect(await sqlState(remove(f.owner, f.id, f.owner))).toBe('42501');
  });

  it('usuário sem vínculo recebe recusa genérica, sem revelar o espaço', async () => {
    const stranger = await createUser();
    expect(await sqlState(remove(stranger, f.id, f.viewer))).toBe('42501');
    expect(await sqlState(remove(stranger, randomUUID(), f.viewer))).toBe('42501');
  });

  it('membro recebe "não encontrado" ao remover quem não é membro', async () => {
    expect(await sqlState(remove(f.owner, f.id, randomUUID()))).toBe('P0002');
  });

  it('exige autenticação', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      expect(await sqlState(client.query('select public.remove_household_member($1, $2)', [f.id, f.viewer]))).toBe('42501');
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('registra a remoção na auditoria', async () => {
    await remove(f.admin, f.id, f.viewer);
    const { rows } = await pool.query(
      "select actor_id, entity_id, metadata from app_private.audit_events where household_id = $1 and action = 'household_member.removed'",
      [f.id],
    );
    expect(rows).toEqual([{ actor_id: f.admin, entity_id: f.viewer, metadata: { role: 'viewer', self: false } }]);
  });

  it('não permite um segundo owner', async () => {
    expect(
      await sqlState(pool.query("update public.household_members set role = 'owner' where household_id = $1 and user_id = $2", [f.id, f.admin])),
    ).toBe('23505');
  });
});

describe('revogação invalida o acesso subsequente', () => {
  it('membro removido deixa de ver espaço, membros e perfis, e não altera nada', async () => {
    const f = await family();
    expect(await visibleHouseholds(f.admin)).toContain(f.id);

    await remove(f.owner, f.id, f.admin);

    expect(await visibleHouseholds(f.admin)).not.toContain(f.id);
    const members = await asUser(f.admin, async (db) =>
      (await db.query('select * from public.household_members where household_id = $1', [f.id])).rows,
    );
    expect(members).toEqual([]);
    const profiles = await asUser(f.admin, async (db) => (await db.query('select id from public.profiles')).rows.map((r) => r.id));
    expect(profiles).toEqual([f.admin]);
    const updated = await asUser(f.admin, async (db) =>
      (await db.query("update public.households set name = 'Depois' where id = $1", [f.id])).rowCount,
    );
    expect(updated).toBe(0);
    expect(await sqlState(remove(f.admin, f.id, f.viewer))).toBe('42501');
  });

  it('a revogação vale para uma sessão já aberta (sem depender do token expirar)', async () => {
    const f = await family();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [f.viewer]);
      const before = await client.query('select id from public.households where id = $1', [f.id]);
      expect(before.rows).toHaveLength(1);

      await remove(f.owner, f.id, f.viewer); // em outra conexão, já confirmada

      const after = await client.query('select id from public.households where id = $1', [f.id]);
      expect(after.rows).toHaveLength(0);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
