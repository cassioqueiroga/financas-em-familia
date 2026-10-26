import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asAnon, createUser, pool, sqlState } from './helpers';
import { balance, categoryId, couple, createAccount, createEntry, one, q, randomUUID, type Couple } from './finance-helpers';

afterAll(async () => {
  await pool.end();
});

let c: Couple;
beforeEach(async () => {
  c = await couple();
});

describe('Contas', () => {
  it('cria conta com saldo inicial; titular recebe acesso de escrita', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 150000 });
    expect(acc.owner_user_id).toBe(c.chefe);
    expect(await balance(c.chefe, acc.id)).toBe(150000);
    const grants = await q<{ user_id: string; access: string }>(c.chefe, 'select user_id, access from public.account_grants where account_id = $1', [acc.id]);
    expect(grants).toEqual([{ user_id: c.chefe, access: 'write' }]);
  });

  it('é idempotente: mesma chave não duplica e chave com outros dados é recusada', async () => {
    const key = randomUUID();
    const call = (name: string) =>
      one<{ id: string }>(c.chefe, 'select * from public.create_account($1, $2, $3, $4)', [c.chefePersonal, name, 'checking', key]);
    const a = await call('Corrente');
    const b = await call('Corrente');
    expect(b.id).toBe(a.id);
    expect(await sqlState(call('Outra'))).toBe('23505');
  });

  it('valida nome, nome duplicado, campos de cartão e tipo', async () => {
    expect(await sqlState(createAccount(c.chefe, c.chefePersonal, { name: '   ' }))).toBe('23514');
    await createAccount(c.chefe, c.chefePersonal, { name: 'Nubank' });
    expect(await sqlState(createAccount(c.chefe, c.chefePersonal, { name: ' nubank ' }))).toBe('23505');
    expect(await sqlState(createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', closingDay: 31 }))).toBe('23514');
    expect(await sqlState(createAccount(c.chefe, c.chefePersonal, { initial: 1e13 }))).toBe('23514');
  });

  it('titular edita nome e saldo inicial com controle de versão', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 1000 });
    const updated = await one<{ name: string; version: number }>(
      c.chefe,
      'select * from public.update_account($1, $2, $3, $4)',
      [acc.id, acc.version, 'Conta renomeada', 5000],
    );
    expect(updated.name).toBe('Conta renomeada');
    expect(await balance(c.chefe, acc.id)).toBe(5000);
    expect(await sqlState(q(c.chefe, 'select public.update_account($1, $2, $3)', [acc.id, acc.version, 'Velha']))).toBe('40001');
  });

  it('não permite mover a data do saldo inicial para depois de lançamentos existentes', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { date: '2026-01-01' });
    await createEntry(c.chefe, acc.id, { date: '2026-02-01' });
    const cur = await one<{ version: number }>(c.chefe, 'select version from public.accounts where id = $1', [acc.id]);
    expect(
      await sqlState(q(c.chefe, 'select public.update_account($1, $2, $3, $4, $5)', [acc.id, cur.version, 'X', 0, '2026-03-01'])),
    ).toBe('23514');
  });

  it('desativar preserva histórico e bloqueia novos lançamentos', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 1000 });
    await createEntry(c.chefe, acc.id, { amount: 300 });
    await q(c.chefe, 'select public.set_account_active($1, $2, false)', [acc.id, acc.version]);
    expect(await balance(c.chefe, acc.id)).toBe(700);
    expect((await q(c.chefe, 'select id from public.transactions where account_id = $1', [acc.id])).length).toBe(1);
    expect(await sqlState(createEntry(c.chefe, acc.id))).toBe('23514');
  });
});

describe('Privacidade e compartilhamento (D04/D05/D14)', () => {
  it('conta pessoal não é vista pela esposa nem por estranhos', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 1000 });
    await createEntry(c.chefe, acc.id);
    const stranger = await createUser();
    for (const user of [c.esposa, stranger]) {
      expect(await q(user, 'select id from public.accounts where id = $1', [acc.id])).toEqual([]);
      expect(await q(user, 'select id from public.transactions where account_id = $1', [acc.id])).toEqual([]);
      expect(await balance(user, acc.id)).toBeUndefined();
      expect(await sqlState(createEntry(user, acc.id))).toBe('42501');
    }
  });

  it('conta da família sem concessão não é vista nem pelo owner do espaço', async () => {
    const acc = await createAccount(c.esposa, c.family, { initial: 1000 });
    expect(await q(c.chefe, 'select id from public.accounts where id = $1', [acc.id])).toEqual([]);
    expect(await sqlState(createEntry(c.chefe, acc.id))).toBe('42501');
  });

  it('concessão explícita libera leitura e escrita; revogação vale na hora', async () => {
    const acc = await createAccount(c.chefe, c.family, { initial: 1000, shareWith: [c.esposa] });
    await createEntry(c.esposa, acc.id, { amount: 200 });
    expect(await balance(c.esposa, acc.id)).toBe(800);
    await q(c.chefe, 'select public.revoke_account_access($1, $2)', [acc.id, c.esposa]);
    expect(await q(c.esposa, 'select id from public.accounts where id = $1', [acc.id])).toEqual([]);
    expect(await q(c.esposa, 'select id from public.transactions where account_id = $1', [acc.id])).toEqual([]);
    expect(await sqlState(createEntry(c.esposa, acc.id))).toBe('42501');
  });

  it('concessão de leitura não permite lançar', async () => {
    const acc = await createAccount(c.chefe, c.family, { shareWith: [c.esposa], access: 'read' });
    expect((await q(c.esposa, 'select id from public.accounts where id = $1', [acc.id])).length).toBe(1);
    expect(await sqlState(createEntry(c.esposa, acc.id))).toBe('42501');
  });

  it('papel viewer limita a concessão a leitura', async () => {
    const v = await couple('viewer');
    const acc = await createAccount(v.chefe, v.family, { shareWith: [v.esposa], access: 'write' });
    expect((await q(v.esposa, 'select id from public.accounts where id = $1', [acc.id])).length).toBe(1);
    expect(await sqlState(createEntry(v.esposa, acc.id))).toBe('42501');
    expect(await sqlState(createAccount(v.esposa, v.family))).toBe('42501');
  });

  it('só o titular compartilha, revoga, edita ou desativa', async () => {
    const acc = await createAccount(c.chefe, c.family, { shareWith: [c.esposa] });
    expect(await sqlState(q(c.esposa, 'select public.revoke_account_access($1, $2)', [acc.id, c.chefe]))).toBe('42501');
    expect(await sqlState(q(c.esposa, 'select public.update_account($1, $2, $3)', [acc.id, acc.version, 'X']))).toBe('42501');
    expect(await sqlState(q(c.esposa, 'select public.set_account_active($1, $2, false)', [acc.id, acc.version]))).toBe('42501');
    expect(await sqlState(q(c.chefe, 'select public.revoke_account_access($1, $2)', [acc.id, c.chefe]))).toBe('23514');
  });

  it('não compartilha com quem não é membro do espaço nem cria conta em espaço alheio', async () => {
    const stranger = await createUser();
    expect(await sqlState(createAccount(c.chefe, c.family, { shareWith: [stranger] }))).toBe('23514');
    const acc = await createAccount(c.chefe, c.family);
    expect(await sqlState(q(c.chefe, 'select public.grant_account_access($1, $2, $3)', [acc.id, stranger, 'read']))).toBe('23514');
    expect(await sqlState(createAccount(c.esposa, c.chefePersonal))).toBe('42501');
  });

  it('removida do espaço, a esposa perde as concessões e o acesso', async () => {
    const acc = await createAccount(c.chefe, c.family, { shareWith: [c.esposa] });
    await q(c.chefe, 'select public.remove_household_member($1, $2)', [c.family, c.esposa]);
    expect((await pool.query('select 1 from public.account_grants where account_id = $1 and user_id = $2', [acc.id, c.esposa])).rowCount).toBe(0);
    expect(await q(c.esposa, 'select id from public.accounts where id = $1', [acc.id])).toEqual([]);
  });

  it('trocar o id no pedido não dá acesso: lançamento alheio não é editável nem cancelável', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    const e = await createEntry(c.chefe, acc.id);
    expect(await sqlState(q(c.esposa, 'select public.cancel_entry($1, $2)', [e.id, e.version]))).toBe('42501');
    expect(
      await sqlState(q(c.esposa, 'select public.update_entry($1, $2, $3, $4, $5, $6)', [e.id, e.version, 1, '2026-03-10', 'x', randomUUID()])),
    ).toBe('42501');
    expect(await sqlState(q(c.esposa, 'select public.settle_entry($1, $2, $3)', [e.id, e.version, '2026-03-10']))).toBe('42501');
  });

  it('autenticado não escreve direto nas tabelas financeiras; anon não lê', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    expect(
      await sqlState(
        q(c.chefe, "insert into public.transactions (household_id, account_id, kind, amount_cents, occurred_on, description, created_by) values ($1, $2, 'income', 1, '2026-03-01', 'x', $3)", [
          c.chefePersonal,
          acc.id,
          c.chefe,
        ]),
      ),
    ).toBe('42501');
    expect(await sqlState(q(c.chefe, 'update public.accounts set name = $2 where id = $1', [acc.id, 'X']))).toBe('42501');
    expect(await sqlState(q(c.chefe, 'delete from public.transactions'))).toBe('42501');
    expect(await sqlState(asAnon((db) => db.query('select * from public.accounts')))).toBe('42501');
    expect(await sqlState(asAnon((db) => db.query('select * from public.account_balances')))).toBe('42501');
  });
});

describe('Categorias', () => {
  it('espaço novo recebe categorias padrão uma única vez (idempotente)', async () => {
    const count = async () =>
      Number((await pool.query('select count(*) from public.categories where household_id = $1', [c.family])).rows[0].count);
    const before = await count();
    expect(before).toBeGreaterThanOrEqual(15);
    await q(c.chefe, 'select public.ensure_default_categories($1)', [c.family]);
    await q(c.chefe, 'select public.ensure_default_categories($1)', [c.family]);
    expect(await count()).toBe(before);
  });

  it('membros veem e criam; nome duplicado é recusado; estranho não vê', async () => {
    const stranger = await createUser();
    const cat = await one<{ id: string; version: number }>(c.esposa, 'select * from public.create_category($1, $2, $3, $4)', [
      c.family,
      'Farmácia',
      'expense',
      randomUUID(),
    ]);
    expect((await q(c.chefe, 'select id from public.categories where id = $1', [cat.id])).length).toBe(1);
    expect(await q(stranger, 'select id from public.categories where id = $1', [cat.id])).toEqual([]);
    expect(await sqlState(q(c.chefe, 'select public.create_category($1, $2, $3, $4)', [c.family, 'farmácia ', 'expense', randomUUID()]))).toBe(
      '23505',
    );
    // Mesmo nome com outro tipo é permitido.
    await q(c.chefe, 'select public.create_category($1, $2, $3, $4)', [c.family, 'Farmácia', 'income', randomUUID()]);
  });

  it('categoria inativa não é usada em novos lançamentos e o histórico continua apontando para ela', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    const catId = await categoryId(c.chefe, c.chefePersonal, 'Lazer');
    const e = await createEntry(c.chefe, acc.id, { category: catId });
    const cat = await one<{ version: number }>(c.chefe, 'select version from public.categories where id = $1', [catId]);
    await q(c.chefe, 'select public.update_category($1, $2, $3, false)', [catId, cat.version, 'Lazer']);
    expect(await sqlState(createEntry(c.chefe, acc.id, { category: catId }))).toBe('23514');
    expect((await one<{ category_id: string }>(c.chefe, 'select category_id from public.transactions where id = $1', [e.id])).category_id).toBe(catId);
  });

  it('categoria de outro espaço ou de tipo errado é recusada', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    const otherSpace = await categoryId(c.chefe, c.family, 'Lazer');
    const incomeCat = await categoryId(c.chefe, c.chefePersonal, 'Salário');
    expect(await sqlState(createEntry(c.chefe, acc.id, { category: otherSpace }))).toBe('23514');
    expect(await sqlState(createEntry(c.chefe, acc.id, { kind: 'expense', category: incomeCat }))).toBe('23514');
  });
});

describe('Receitas, despesas e saldos', () => {
  it('receita soma, despesa subtrai e pendente não altera o saldo', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    await createEntry(c.chefe, acc.id, { kind: 'income', amount: 5000 });
    await createEntry(c.chefe, acc.id, { kind: 'expense', amount: 1234 });
    expect(await balance(c.chefe, acc.id)).toBe(13766);
    await createEntry(c.chefe, acc.id, { kind: 'expense', amount: 999, status: 'pending' });
    expect(await balance(c.chefe, acc.id)).toBe(13766);
    const row = await one<{ pending_expense_cents: string }>(c.chefe, 'select pending_expense_cents from public.account_balances where account_id = $1', [acc.id]);
    expect(Number(row.pending_expense_cents)).toBe(999);
  });

  it('efetivar pendente altera o saldo uma única vez', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const e = await createEntry(c.chefe, acc.id, { amount: 2500, status: 'pending', date: '2026-04-05' });
    await q(c.chefe, 'select public.settle_entry($1, $2, $3)', [e.id, e.version, '2026-04-03']);
    expect(await balance(c.chefe, acc.id)).toBe(7500);
    expect(await sqlState(q(c.chefe, 'select public.settle_entry($1, $2, $3)', [e.id, e.version + 1, '2026-04-03']))).toBe('23514');
  });

  it('repetir a mesma chave não lança duas vezes (inclusive em paralelo)', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => createEntry(c.chefe, acc.id, { amount: 100, key })));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await balance(c.chefe, acc.id)).toBe(9900);
  });

  it('valida valor, data, descrição, responsável e tipo', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { date: '2026-01-01' });
    const stranger = await createUser();
    expect(await sqlState(createEntry(c.chefe, acc.id, { amount: 0 }))).toBe('23514');
    expect(await sqlState(createEntry(c.chefe, acc.id, { amount: -5 }))).toBe('23514');
    expect(await sqlState(createEntry(c.chefe, acc.id, { date: '2025-12-31' }))).toBe('23514');
    expect(await sqlState(createEntry(c.chefe, acc.id, { description: '  ' }))).toBe('23514');
    expect(await sqlState(createEntry(c.chefe, acc.id, { attributedTo: stranger }))).toBe('23514');
    expect(
      await sqlState(q(c.chefe, 'select public.create_entry($1, $2, $3, $4, $5, $6)', [acc.id, 'transfer_in', 10, '2026-03-01', 'x', randomUUID()])),
    ).toBe('22023');
  });

  it('editar cancela o original, cria o substituto e recalcula o saldo', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const e = await createEntry(c.chefe, acc.id, { amount: 1000 });
    const n = await one<{ id: string; replaces_id: string; amount_cents: string }>(
      c.chefe,
      'select * from public.update_entry($1, $2, $3, $4, $5, $6)',
      [e.id, e.version, 3000, '2026-03-11', 'Corrigido', randomUUID()],
    );
    expect(n.replaces_id).toBe(e.id);
    expect(await balance(c.chefe, acc.id)).toBe(7000);
    const old = await one<{ status: string }>(c.chefe, 'select status from public.transactions where id = $1', [e.id]);
    expect(old.status).toBe('cancelled');
    expect(
      await sqlState(q(c.chefe, 'select public.update_entry($1, $2, $3, $4, $5, $6)', [e.id, e.version, 1, '2026-03-11', 'x', randomUUID()])),
    ).toBe('23514');
  });

  it('cancelar (estornar) recalcula o saldo, preserva o registro e vai para a auditoria', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const e = await createEntry(c.chefe, acc.id, { amount: 4000 });
    await q(c.chefe, 'select public.cancel_entry($1, $2)', [e.id, e.version]);
    expect(await balance(c.chefe, acc.id)).toBe(10000);
    expect((await q(c.chefe, 'select id from public.transactions where id = $1', [e.id])).length).toBe(1);
    expect(await sqlState(q(c.chefe, 'select public.cancel_entry($1, $2)', [e.id, e.version + 1]))).toBe('23514');
    const audit = await pool.query("select metadata from app_private.audit_events where entity_id = $1 and action = 'entry.cancelled'", [e.id]);
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('4000');
  });

  it('edição concorrente com versão antiga é recusada', async () => {
    const acc = await createAccount(c.chefe, c.family, { shareWith: [c.esposa], initial: 10000 });
    const e = await createEntry(c.chefe, acc.id, { amount: 1000 });
    await q(c.esposa, 'select public.update_entry($1, $2, $3, $4, $5, $6)', [e.id, e.version, 2000, '2026-03-10', 'Esposa', randomUUID()]);
    expect(
      await sqlState(q(c.chefe, 'select public.update_entry($1, $2, $3, $4, $5, $6)', [e.id, e.version, 3000, '2026-03-10', 'Chefe', randomUUID()])),
    ).toBe('23514');
    expect(await balance(c.chefe, acc.id)).toBe(8000);
  });

  it('list_entries respeita o intervalo e o RLS', async () => {
    const acc = await createAccount(c.chefe, c.family, { initial: 0 });
    await createEntry(c.chefe, acc.id, { date: '2026-03-01' });
    await createEntry(c.chefe, acc.id, { date: '2026-04-01' });
    expect((await q(c.chefe, 'select * from public.list_entries($1, $2, $3)', [c.family, '2026-03-01', '2026-03-31'])).length).toBe(1);
    expect(await q(c.esposa, 'select * from public.list_entries($1, $2, $3)', [c.family, '2026-01-01', '2026-12-31'])).toEqual([]);
  });
});

describe('Transferências', () => {
  it('debita a origem, credita o destino e não é receita nem despesa', async () => {
    const a = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const b = await createAccount(c.chefe, c.chefePersonal, { kind: 'savings', initial: 0 });
    const t = await one<{ create_transfer: string }>(c.chefe, 'select public.create_transfer($1, $2, $3, $4, $5, $6)', [
      a.id,
      b.id,
      2500,
      '2026-03-05',
      'Reserva',
      randomUUID(),
    ]);
    expect(t.create_transfer).toBeTruthy();
    expect(await balance(c.chefe, a.id)).toBe(7500);
    expect(await balance(c.chefe, b.id)).toBe(2500);
    const kinds = (await q<{ kind: string }>(c.chefe, 'select kind from public.transactions where transfer_id = $1 order by kind', [t.create_transfer])).map(
      (r) => r.kind,
    );
    expect(kinds).toEqual(['transfer_out', 'transfer_in']);
  });

  it('da conta pessoal para a conta da família compartilhada', async () => {
    const mine = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const fam = await createAccount(c.chefe, c.family, { shareWith: [c.esposa] });
    await q(c.chefe, 'select public.create_transfer($1, $2, $3, $4, $5, $6)', [mine.id, fam.id, 4000, '2026-03-05', 'Contribuição', randomUUID()]);
    expect(await balance(c.esposa, fam.id)).toBe(4000);
    expect(await balance(c.esposa, mine.id)).toBeUndefined();
  });

  it('recusa mesma conta, conta sem acesso, cartão e é idempotente', async () => {
    const a = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const hers = await createAccount(c.esposa, c.esposaPersonal);
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card' });
    const tr = (to: string, key = randomUUID()) =>
      q(c.chefe, 'select public.create_transfer($1, $2, $3, $4, $5, $6)', [a.id, to, 100, '2026-03-05', 'x', key]);
    expect(await sqlState(tr(a.id))).toBe('23514');
    expect(await sqlState(tr(hers.id))).toBe('42501');
    expect(await sqlState(tr(card.id))).toBe('23514');
    const b = await createAccount(c.chefe, c.chefePersonal);
    const key = randomUUID();
    await tr(b.id, key);
    await tr(b.id, key);
    expect(await balance(c.chefe, a.id)).toBe(9900);
  });

  it('cancelar uma perna cancela as duas (atomicidade)', async () => {
    const a = await createAccount(c.chefe, c.chefePersonal, { initial: 10000 });
    const b = await createAccount(c.chefe, c.chefePersonal);
    const t = await one<{ create_transfer: string }>(c.chefe, 'select public.create_transfer($1, $2, $3, $4, $5, $6)', [a.id, b.id, 3000, '2026-03-05', 'x', randomUUID()]);
    const leg = await one<{ id: string; version: number }>(c.chefe, "select id, version from public.transactions where transfer_id = $1 and kind = 'transfer_in'", [
      t.create_transfer,
    ]);
    await q(c.chefe, 'select public.cancel_entry($1, $2)', [leg.id, leg.version]);
    expect(await balance(c.chefe, a.id)).toBe(10000);
    expect(await balance(c.chefe, b.id)).toBe(0);
  });

  it('falha no meio não deixa perna solta (transação inteira é desfeita)', async () => {
    const a = await createAccount(c.chefe, c.chefePersonal, { initial: 10000, date: '2026-01-01' });
    const b = await createAccount(c.chefe, c.chefePersonal, { date: '2026-06-01' });
    // Data válida para a origem, inválida para o destino.
    expect(await sqlState(q(c.chefe, 'select public.create_transfer($1, $2, $3, $4, $5, $6)', [a.id, b.id, 100, '2026-03-05', 'x', randomUUID()]))).toBe(
      '23514',
    );
    expect((await q(c.chefe, 'select id from public.transactions where account_id in ($1, $2)', [a.id, b.id])).length).toBe(0);
  });
});
