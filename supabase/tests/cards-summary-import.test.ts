import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, sqlState } from './helpers';
import { balance, categoryId, couple, createAccount, createEntry, one, q, randomUUID, type Couple } from './finance-helpers';

afterAll(async () => {
  await pool.end();
});

let c: Couple;
beforeEach(async () => {
  c = await couple();
});

const purchase = (user: string, card: string, total: number, n: number, date: string, opts: { category?: string; attributedTo?: string; key?: string } = {}) =>
  one<{ id: string; version: number }>(
    user,
    `select * from public.create_card_purchase(p_card_account_id => $1, p_total_cents => $2, p_installment_count => $3,
       p_purchased_on => $4, p_description => $5, p_idempotency_key => $6, p_category_id => $7, p_attributed_to => $8)`,
    [card, total, n, date, 'Compra teste', opts.key ?? randomUUID(), opts.category ?? null, opts.attributedTo ?? null],
  );

interface Statement {
  statement_month: string;
  closing_date: string;
  due_date: string;
  total_cents: string;
  paid_cents: string;
  remaining_cents: string;
  status: string;
}
const statements = (user: string, card: string) =>
  q<Statement>(
    user,
    `select to_char(statement_month, 'YYYY-MM-DD') as statement_month, to_char(closing_date, 'YYYY-MM-DD') as closing_date,
            to_char(due_date, 'YYYY-MM-DD') as due_date, total_cents, paid_cents, remaining_cents, status
     from public.card_statements($1)`,
    [card],
  );

describe('Cartões: compras, parcelas e faturas', () => {
  it('compra antes do fechamento entra na fatura do mês; no dia do fechamento, na seguinte', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', closingDay: 10, dueDay: 20 });
    await purchase(c.chefe, card.id, 1000, 1, '2026-03-09');
    await purchase(c.chefe, card.id, 2000, 1, '2026-03-10');
    const s = await statements(c.chefe, card.id);
    expect(s.map((x) => [x.statement_month, Number(x.total_cents)])).toEqual([
      ['2026-03-01', 1000],
      ['2026-04-01', 2000],
    ]);
    expect(s[0]!.closing_date).toBe('2026-03-10');
    expect(s[0]!.due_date).toBe('2026-03-20');
  });

  it('vencimento antes do fechamento cai no mês seguinte', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', closingDay: 25, dueDay: 5 });
    await purchase(c.chefe, card.id, 1000, 1, '2026-12-01');
    const [s] = await statements(c.chefe, card.id);
    expect(s!.closing_date).toBe('2026-12-25');
    expect(s!.due_date).toBe('2027-01-05');
  });

  it('parcelamento divide em centavos exatos (resto nas primeiras) em meses consecutivos', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', closingDay: 10, dueDay: 20 });
    const p = await purchase(c.chefe, card.id, 10000, 3, '2026-11-15');
    const rows = await q<{ amount_cents: string; installment_number: number; m: string }>(
      c.chefe,
      "select amount_cents, installment_number, to_char(statement_month, 'YYYY-MM') as m from public.transactions where purchase_id = $1 order by installment_number",
      [p.id],
    );
    expect(rows.map((r) => [r.installment_number, Number(r.amount_cents), r.m])).toEqual([
      [1, 3334, '2026-12'],
      [2, 3333, '2027-01'],
      [3, 3333, '2027-02'],
    ]);
  });

  it('limite disponível desconta compras e volta com pagamento; saldo do cartão é a dívida', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', limit: 100000 });
    const bank = await createAccount(c.chefe, c.chefePersonal, { initial: 50000 });
    await purchase(c.chefe, card.id, 30000, 3, '2026-03-01');
    const before = await one<{ available_credit_cents: string; balance_cents: string }>(c.chefe, 'select * from public.account_balances where account_id = $1', [card.id]);
    expect(Number(before.available_credit_cents)).toBe(70000);
    expect(Number(before.balance_cents)).toBe(-30000);
    await q(c.chefe, 'select public.pay_card_statement($1, $2, $3, $4, $5, $6)', [card.id, '2026-03-01', bank.id, 10000, '2026-03-20', randomUUID()]);
    const after = await one<{ available_credit_cents: string }>(c.chefe, 'select * from public.account_balances where account_id = $1', [card.id]);
    expect(Number(after.available_credit_cents)).toBe(80000);
    expect(await balance(c.chefe, bank.id)).toBe(40000);
  });

  it('pagamento parcial e total atualizam a situação da fatura', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', closingDay: 10, dueDay: 20 });
    const bank = await createAccount(c.chefe, c.chefePersonal, { initial: 50000 });
    await purchase(c.chefe, card.id, 5000, 1, '2026-01-05');
    let [s] = await statements(c.chefe, card.id);
    expect(s!.status).toBe('overdue'); // venceu em 20/01/2026 e não foi paga
    await q(c.chefe, 'select public.pay_card_statement($1, $2, $3, $4, $5, $6)', [card.id, '2026-01-01', bank.id, 2000, '2026-01-20', randomUUID()]);
    [s] = await statements(c.chefe, card.id);
    expect(Number(s!.remaining_cents)).toBe(3000);
    await q(c.chefe, 'select public.pay_card_statement($1, $2, $3, $4, $5, $6)', [card.id, '2026-01-01', bank.id, 3000, '2026-01-21', randomUUID()]);
    [s] = await statements(c.chefe, card.id);
    expect(s!.status).toBe('paid');
  });

  it('fatura futura aparece como aberta', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', closingDay: 10, dueDay: 20 });
    await purchase(c.chefe, card.id, 1200, 12, '2098-01-05');
    const s = await statements(c.chefe, card.id);
    expect(s).toHaveLength(12);
    expect(s.every((x) => x.status === 'open')).toBe(true);
  });

  it('cancelar a compra cancela todas as parcelas e libera o limite', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card', limit: 100000 });
    const p = await purchase(c.chefe, card.id, 30000, 3, '2026-03-01');
    const charge = await one<{ id: string; version: number }>(c.chefe, 'select id, version from public.transactions where purchase_id = $1 limit 1', [p.id]);
    expect(await sqlState(q(c.chefe, 'select public.cancel_entry($1, $2)', [charge.id, charge.version]))).toBe('23514');
    await q(c.chefe, 'select public.cancel_card_purchase($1, $2)', [p.id, p.version]);
    expect(await balance(c.chefe, card.id)).toBe(0);
    expect(await statements(c.chefe, card.id)).toEqual([]);
  });

  it('cancelar o pagamento devolve o valor à conta e reabre a fatura', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card' });
    const bank = await createAccount(c.chefe, c.chefePersonal, { initial: 50000 });
    await purchase(c.chefe, card.id, 5000, 1, '2026-03-01');
    const t = await one<{ pay_card_statement: string }>(c.chefe, 'select public.pay_card_statement($1, $2, $3, $4, $5, $6)', [
      card.id,
      '2026-03-01',
      bank.id,
      5000,
      '2026-03-20',
      randomUUID(),
    ]);
    const leg = await one<{ id: string; version: number }>(c.chefe, "select id, version from public.transactions where transfer_id = $1 and kind = 'card_payment_out'", [
      t.pay_card_statement,
    ]);
    await q(c.chefe, 'select public.cancel_entry($1, $2)', [leg.id, leg.version]);
    expect(await balance(c.chefe, bank.id)).toBe(50000);
    expect(Number((await statements(c.chefe, card.id))[0]!.remaining_cents)).toBe(5000);
  });

  it('recusa compra em conta comum, parcelas inválidas, cartão alheio e é idempotente', async () => {
    const bank = await createAccount(c.chefe, c.chefePersonal);
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card' });
    expect(await sqlState(purchase(c.chefe, bank.id, 1000, 1, '2026-03-01'))).toBe('23514');
    expect(await sqlState(purchase(c.chefe, card.id, 1000, 0, '2026-03-01'))).toBe('23514');
    expect(await sqlState(purchase(c.chefe, card.id, 1000, 49, '2026-03-01'))).toBe('23514');
    expect(await sqlState(purchase(c.esposa, card.id, 1000, 1, '2026-03-01'))).toBe('42501');
    const key = randomUUID();
    await purchase(c.chefe, card.id, 1000, 2, '2026-03-01', { key });
    await purchase(c.chefe, card.id, 1000, 2, '2026-03-01', { key });
    expect(await balance(c.chefe, card.id)).toBe(-1000);
  });

  it('receita/despesa comum não pode ser lançada no cartão nem fatura paga com cartão', async () => {
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card' });
    const card2 = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card' });
    expect(await sqlState(createEntry(c.chefe, card.id))).toBe('23514');
    expect(await sqlState(q(c.chefe, 'select public.pay_card_statement($1, $2, $3, $4, $5, $6)', [card.id, '2026-03-01', card2.id, 100, '2026-03-20', randomUUID()]))).toBe(
      '23514',
    );
  });
});

describe('Resumo mensal', () => {
  it('soma receitas e despesas do mês, conta cartão pela fatura e não conta pagamento nem transferência', async () => {
    const bank = await createAccount(c.chefe, c.family, { initial: 100000, shareWith: [c.esposa] });
    const savings = await createAccount(c.chefe, c.family, { kind: 'savings', shareWith: [c.esposa] });
    const card = await createAccount(c.chefe, c.family, { kind: 'credit_card', closingDay: 10, dueDay: 20, shareWith: [c.esposa] });
    const mercado = await categoryId(c.chefe, c.family, 'Mercado');
    const salario = await categoryId(c.chefe, c.family, 'Salário');
    await q(c.esposa, 'select public.update_my_profile($1)', ['Esposa']);

    await createEntry(c.chefe, bank.id, { kind: 'income', amount: 500000, date: '2026-03-05', category: salario, attributedTo: c.chefe });
    await createEntry(c.esposa, bank.id, { kind: 'expense', amount: 30000, date: '2026-03-06', category: mercado, attributedTo: c.esposa });
    await createEntry(c.chefe, bank.id, { kind: 'expense', amount: 20000, date: '2026-03-15', status: 'pending', description: 'Luz' });
    await createEntry(c.chefe, bank.id, { kind: 'expense', amount: 7000, date: '2026-04-01' }); // outro mês
    // Compra em 05/02 vai para a fatura de fevereiro; compra de 2x em 01/03 tem 1ª parcela em março.
    await purchase(c.chefe, card.id, 9999, 1, '2026-02-05', { category: mercado, attributedTo: c.chefe });
    await purchase(c.esposa, card.id, 20000, 2, '2026-03-01', { category: mercado, attributedTo: c.esposa });
    await q(c.chefe, 'select public.create_transfer($1, $2, $3, $4, $5, $6)', [bank.id, savings.id, 50000, '2026-03-10', 'Reserva', randomUUID()]);
    await q(c.chefe, 'select public.pay_card_statement($1, $2, $3, $4, $5, $6)', [card.id, '2026-02-01', bank.id, 9999, '2026-03-02', randomUUID()]);

    const s = (await one<{ monthly_summary: Record<string, unknown> }>(c.esposa, 'select public.monthly_summary($1, $2)', [c.family, '2026-03-17'])).monthly_summary;
    expect(s.month).toBe('2026-03-01');
    expect(Number(s.income_cents)).toBe(500000);
    expect(Number(s.expense_cents)).toBe(30000 + 10000);
    expect(Number(s.result_cents)).toBe(500000 - 40000);
    expect(Number(s.pending_expense_cents)).toBe(20000);
    // Saldo disponível: banco + poupança (cartão não entra).
    const bankBalance = 100000 + 500000 - 30000 - 7000 - 50000 - 9999;
    expect(Number(s.available_cents)).toBe(bankBalance + 50000);
    expect(Number(s.card_debt_cents)).toBe(20000);
    const byCat = s.expenses_by_category as { name: string; total_cents: number }[];
    expect(byCat).toEqual([{ category_id: mercado, name: 'Mercado', total_cents: 40000 }]);
    const byMember = s.expenses_by_member as { user_id: string; display_name: string | null; total_cents: number }[];
    expect(byMember).toEqual([{ user_id: c.esposa, display_name: 'Esposa', total_cents: 40000 }]);
    const due = s.statements_due as { statement_month: string; remaining_cents: number }[];
    expect(due).toHaveLength(1);
    expect(due[0]!.statement_month).toBe('2026-03-01');
    expect(Number(due[0]!.remaining_cents)).toBe(10000);
  });

  it('só considera o que o usuário pode ver e mês vazio retorna zeros', async () => {
    const hidden = await createAccount(c.chefe, c.family, { initial: 100000 });
    await createEntry(c.chefe, hidden.id, { kind: 'income', amount: 1000, date: '2026-03-05' });
    const s = (await one<{ monthly_summary: Record<string, unknown> }>(c.esposa, 'select public.monthly_summary($1, $2)', [c.family, '2026-03-01'])).monthly_summary;
    expect(Number(s.income_cents)).toBe(0);
    expect(Number(s.available_cents)).toBe(0);
    expect(s.balances).toEqual([]);
    expect(s.expenses_by_category).toEqual([]);
  });
});

describe('Importação de extratos', () => {
  const rows = [
    { occurred_on: '2026-03-01', amount_cents: 500000, description: 'SALARIO', external_id: 'ofx:FIT1' },
    { occurred_on: '2026-03-02', amount_cents: -12345, description: 'MERCADO', external_id: 'ofx:FIT2' },
    { occurred_on: 'data-ruim', amount_cents: -1, description: 'X', external_id: 'ofx:FIT3' },
    { occurred_on: '2026-03-03', amount_cents: 0, description: 'ZERO', external_id: 'ofx:FIT4' },
  ];
  const doImport = (user: string, account: string, data: unknown, key = randomUUID()) =>
    one<{ import_entries: Record<string, unknown> }>(user, 'select public.import_entries($1, $2, $3, $4)', [account, JSON.stringify(data), 'ofx', key]).then(
      (r) => r.import_entries,
    );

  it('importa válidas, rejeita inválidas com motivo e atualiza o saldo', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { initial: 0, date: '2026-01-01' });
    const r = await doImport(c.chefe, acc.id, rows);
    expect(r.imported).toBe(2);
    expect(r.duplicates).toBe(0);
    expect(r.rejected).toBe(2);
    expect((r.rejected_rows as { index: number }[]).map((x) => x.index)).toEqual([2, 3]);
    expect(await balance(c.chefe, acc.id)).toBe(500000 - 12345);
  });

  it('reimportar o mesmo arquivo não duplica, nem após cancelar um lançamento importado', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    await doImport(c.chefe, acc.id, rows.slice(0, 2));
    const e = await one<{ id: string; version: number }>(c.chefe, "select id, version from public.transactions where external_id = 'ofx:FIT2'");
    await q(c.chefe, 'select public.cancel_entry($1, $2)', [e.id, e.version]);
    const r = await doImport(c.chefe, acc.id, rows.slice(0, 2));
    expect(r.imported).toBe(0);
    expect(r.duplicates).toBe(2);
    expect(await balance(c.chefe, acc.id)).toBe(500000);
  });

  it('pré-visualização marca novos, duplicados, possíveis duplicados e inválidos sem gravar', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    await doImport(c.chefe, acc.id, rows.slice(0, 1));
    await createEntry(c.chefe, acc.id, { kind: 'expense', amount: 12345, date: '2026-03-02' }); // digitado à mão
    const preview = (await one<{ preview_import: { status: string }[] }>(c.chefe, 'select public.preview_import($1, $2)', [acc.id, JSON.stringify(rows)])).preview_import;
    expect(preview.map((p) => p.status)).toEqual(['duplicate', 'possible_duplicate', 'invalid', 'invalid']);
    expect((await q(c.chefe, 'select id from public.transactions where account_id = $1', [acc.id])).length).toBe(2);
  });

  it('recusa conta sem acesso, cartão, excesso de linhas e linhas antes do saldo inicial', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal, { date: '2026-03-02' });
    const card = await createAccount(c.chefe, c.chefePersonal, { kind: 'credit_card' });
    expect(await sqlState(doImport(c.esposa, acc.id, rows))).toBe('42501');
    expect(await sqlState(doImport(c.chefe, card.id, rows))).toBe('23514');
    const many = Array.from({ length: 5001 }, (_, i) => ({ ...rows[0], external_id: `x${i}` }));
    expect(await sqlState(doImport(c.chefe, acc.id, many))).toBe('22023');
    const r = await doImport(c.chefe, acc.id, rows.slice(0, 2));
    expect(r.imported).toBe(1);
    expect(r.rejected).toBe(1);
  });

  it('mesma chave de importação não reimporta (idempotência) e registra o lote', async () => {
    const acc = await createAccount(c.chefe, c.chefePersonal);
    const key = randomUUID();
    await doImport(c.chefe, acc.id, rows.slice(0, 2), key);
    const again = await doImport(c.chefe, acc.id, rows.slice(0, 2), key);
    expect(again.replayed).toBe(true);
    expect(again.imported).toBe(2);
    const batches = await q(c.chefe, 'select imported_rows from public.import_batches where account_id = $1', [acc.id]);
    expect(batches).toEqual([{ imported_rows: 2 }]);
  });
});
