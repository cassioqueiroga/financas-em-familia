import { describe, expect, it } from 'vitest';
import { makeSummary } from '@/test/fakes';
import type { Entry } from '@/features/finance/types';
import { analyze } from './analysis';
import {
  averageSplit,
  byWeekday,
  categoryGroups,
  categoryRows,
  cumulativeByDay,
  detectRecurring,
  groupOf,
  healthScore,
  monthExpenses,
  projectMonth,
  recurringKey,
  splitByGroup,
  topExpenses,
} from './deep';

let seq = 0;
const entry = (o: Partial<Entry>): Entry => ({
  id: `e-${++seq}`,
  household_id: 'h-1',
  account_id: 'a-1',
  kind: 'expense',
  status: 'posted',
  amount_cents: 1000,
  occurred_on: '2026-04-10',
  description: 'Teste',
  category_id: null,
  attributed_to: null,
  transfer_id: null,
  purchase_id: null,
  installment_number: null,
  installment_count: null,
  statement_month: null,
  replaces_id: null,
  import_batch_id: null,
  created_by: 'u-1',
  created_at: '2026-04-10T12:00:00Z',
  version: 1,
  ...o,
});

describe('grupos 50-30-20', () => {
  it('classifica categorias padrão sem depender de acento ou caixa', () => {
    expect(groupOf('Saúde')).toBe('essential');
    expect(groupOf('saude')).toBe('essential');
    expect(groupOf('Alimentação fora')).toBe('lifestyle');
    expect(groupOf('Viagem do casal')).toBe('unclassified');
    expect(groupOf(null)).toBe('unclassified');
  });

  it('divide o mês e calcula a média', () => {
    const s = makeSummary({
      income_cents: 1000000,
      expense_cents: 800000,
      result_cents: 200000,
      expenses_by_category: [
        { category_id: 'c1', name: 'Moradia', total_cents: 500000 },
        { category_id: 'c2', name: 'Lazer', total_cents: 200000 },
        { category_id: null, name: null, total_cents: 100000 },
      ],
    });
    const split = splitByGroup(s);
    expect(split).toEqual({ income_cents: 1000000, essential_cents: 500000, lifestyle_cents: 200000, unclassified_cents: 100000, savings_cents: 200000 });
    expect(averageSplit([split, { ...split, essential_cents: 300000 }])!.essential_cents).toBe(400000);
    expect(averageSplit([])).toBeNull();
  });

  it('usa o grupo escolhido pelo casal e, sem escolha, o automático', () => {
    const cat = (id: string, name: string, budget_group: 'essential' | 'lifestyle' | null, kind: 'expense' | 'income' = 'expense') => ({
      id,
      household_id: 'h-1',
      name,
      kind,
      is_default: false,
      is_active: true,
      budget_group,
      version: 1,
    });
    const groups = categoryGroups([cat('c1', 'Moradia', null), cat('c2', 'Viagem', 'lifestyle'), cat('c3', 'Mercado', 'lifestyle'), cat('c4', 'Bônus', null, 'income')]);
    expect([...groups.entries()]).toEqual([
      ['c1', 'essential'],
      ['c2', 'lifestyle'],
      ['c3', 'lifestyle'],
    ]);
    const s = makeSummary({
      income_cents: 100000,
      expense_cents: 60000,
      result_cents: 40000,
      expenses_by_category: [
        { category_id: 'c2', name: 'Viagem', total_cents: 30000 },
        { category_id: 'c3', name: 'Mercado', total_cents: 20000 },
        { category_id: 'c9', name: 'Farmácia', total_cents: 10000 },
      ],
    });
    expect(splitByGroup(s, groups)).toMatchObject({ essential_cents: 0, lifestyle_cents: 50000, unclassified_cents: 10000 });
    expect(categoryRows(s, null, groups).map((r) => r.group)).toEqual(['lifestyle', 'lifestyle', 'unclassified']);
  });
});

describe('despesas do mês', () => {
  const entries = [
    entry({ amount_cents: 5000, occurred_on: '2026-04-03' }),
    entry({ kind: 'card_charge', amount_cents: 3000, occurred_on: '2026-03-28', statement_month: '2026-04-01', installment_number: 2, installment_count: 3 }),
    entry({ kind: 'card_charge', amount_cents: 7000, occurred_on: '2026-04-20', statement_month: '2026-05-01' }),
    entry({ kind: 'card_payment_out', amount_cents: 9999, occurred_on: '2026-04-15' }),
    entry({ amount_cents: 2000, occurred_on: '2026-04-15', status: 'cancelled' }),
    entry({ kind: 'income', amount_cents: 100000, occurred_on: '2026-04-05' }),
  ];

  it('segue a regra do resumo: despesa pela data, cartão pela fatura, sem pagamentos', () => {
    expect(monthExpenses(entries, '2026-04').map((e) => e.amount_cents).sort()).toEqual([3000, 5000]);
  });

  it('acumula por dia, com parcela antiga no dia 1', () => {
    const curve = cumulativeByDay(entries, '2026-04');
    expect(curve).toHaveLength(30);
    expect(curve[0]).toBe(3000);
    expect(curve[2]).toBe(8000);
    expect(curve[29]).toBe(8000);
  });

  it('projeta o mês pelo ritmo e soma contas agendadas', () => {
    const p = projectMonth(new Array(30).fill(0).map((_, i) => (i + 1) * 1000), 10, 5000);
    expect(p.spent_cents).toBe(10000);
    expect(p.projected_cents).toBe(35000);
  });

  it('separa por dia da semana e lista as maiores', () => {
    const w = byWeekday(entries, '2026-04');
    expect(w.find((d) => d.label === 'Sex')!.total_cents).toBe(5000); // 03/04/2026 é sexta
    expect(w.reduce((s, d) => s + d.total_cents, 0)).toBe(5000);
    expect(topExpenses(entries, '2026-04', 1)[0]!.amount_cents).toBe(5000);
  });
});

describe('recorrentes', () => {
  it('normaliza a descrição', () => {
    expect(recurringKey('NETFLIX.COM 12/04 *Assinatura')).toBe('netflix com assinatura');
    expect(recurringKey('Conta de Luz - Março')).toBe('conta de luz');
  });

  it('detecta só o que se repete em 3 meses com valor parecido', () => {
    const list = [
      ...['2026-01-05', '2026-02-05', '2026-03-05'].map((d) => entry({ description: 'Netflix', amount_cents: 5590, occurred_on: d })),
      ...['2026-01-10', '2026-02-10', '2026-03-10'].map((d, i) => entry({ description: 'Conta de luz', amount_cents: [20000, 21000, 19000][i]!, occurred_on: d })),
      ...['2026-01-12', '2026-02-12', '2026-03-12'].map((d, i) => entry({ description: 'Farmácia', amount_cents: [1000, 9000, 3000][i]!, occurred_on: d })),
      entry({ description: 'Netflix', amount_cents: 5590, occurred_on: '2026-03-06', status: 'cancelled' }),
      ...['2026-01-15', '2026-02-15'].map((d) => entry({ description: 'Academia', amount_cents: 9900, occurred_on: d })),
    ];
    const r = detectRecurring(list);
    expect(r.map((x) => x.key)).toEqual(['conta de luz', 'netflix']);
    expect(r[0]).toMatchObject({ monthly_cents: 20000, months: 3, last_on: '2026-03-10' });
  });
});

describe('categorias do mês', () => {
  it('calcula participação e valor do mês anterior', () => {
    const cur = makeSummary({ expense_cents: 10000, expenses_by_category: [{ category_id: 'c1', name: 'Mercado', total_cents: 4000 }, { category_id: null, name: null, total_cents: 6000 }] });
    const prev = makeSummary({ expenses_by_category: [{ category_id: 'c1', name: 'Mercado', total_cents: 5000 }] });
    const rows = categoryRows(cur, prev);
    expect(rows[0]).toMatchObject({ name: 'Mercado', group: 'essential', share: 0.4, previous_cents: 5000 });
    expect(rows[1]).toMatchObject({ name: 'Sem categoria', previous_cents: 0 });
  });
});

describe('índice de saúde financeira', () => {
  const month = (m: string, income: number, expense: number, extra = {}) =>
    makeSummary({ month: `${m}-01`, income_cents: income, expense_cents: expense, result_cents: income - expense, ...extra });

  it('dá nota alta para quem poupa 20%, tem 6 meses de reserva e cartão leve', () => {
    const summaries = [month('2026-01', 1000000, 800000), month('2026-02', 1000000, 800000), month('2026-03', 1000000, 800000, { available_cents: 4800000 })];
    const a = analyze({ summaries, statements: [], today: '2026-04' });
    const h = healthScore(a, summaries.at(-1)!);
    expect(h.pillars.map((p) => p.score)).toEqual([100, 100, 100, 100]);
    expect(h).toMatchObject({ score: 100, band: 'healthy' });
  });

  it('dá nota baixa para déficit, sem reserva e fatura pesada', () => {
    const summaries = [month('2026-01', 500000, 600000), month('2026-02', 500000, 600000), month('2026-03', 500000, 600000)];
    const statements = [{ statement_month: '2026-04-01', closing_date: '2026-04-05', due_date: '2026-04-15', total_cents: 300000, paid_cents: 0, remaining_cents: 300000, status: 'open' as const }];
    const a = analyze({ summaries, statements, today: '2026-03' });
    const h = healthScore(a, summaries.at(-1)!);
    expect(h.pillars[0]!.score).toBe(0);
    expect(h.pillars[1]!.score).toBe(0);
    expect(h.pillars[2]!.score).toBe(0);
    expect(h.band).toBe('vulnerable');
  });
});
