import { describe, expect, it } from 'vitest';
import { makeEntry, makeSummary } from '@/test/fakes';
import { filterEntries, filterSummary, filteredExpense, yearToDate, yearToDateMonths } from './ytd';

const cats = (mercado: number, lazer: number, sem = 0) => [
  { category_id: 'c-m', name: 'Mercado', total_cents: mercado },
  { category_id: 'c-l', name: 'Lazer', total_cents: lazer },
  ...(sem ? [{ category_id: null, name: null, total_cents: sem }] : []),
];
const month = (m: string, income: number, mercado: number, lazer: number, sem = 0) =>
  makeSummary({
    month: `${m}-01`,
    income_cents: income,
    expense_cents: mercado + lazer + sem,
    result_cents: income - mercado - lazer - sem,
    expenses_by_category: cats(mercado, lazer, sem),
  });

describe('filtro de categorias', () => {
  const s = month('2026-03', 100000, 30000, 20000, 5000);
  it('sem filtro devolve o resumo original', () => {
    expect(filterSummary(s, null)).toBe(s);
    expect(filteredExpense(s, null)).toBe(55000);
  });
  it('soma só as categorias escolhidas, incluindo "sem categoria"', () => {
    expect(filteredExpense(s, new Set(['c-m', 'sem']))).toBe(35000);
    const f = filterSummary(s, new Set(['c-l']));
    expect(f.expense_cents).toBe(20000);
    expect(f.result_cents).toBe(s.result_cents);
    expect(f.expenses_by_category).toHaveLength(1);
  });
  it('filtra despesas e parcelas, nunca receitas', () => {
    const list = [
      makeEntry({ id: '1', kind: 'expense', category_id: 'c-m' }),
      makeEntry({ id: '2', kind: 'card_charge', category_id: 'c-l' }),
      makeEntry({ id: '3', kind: 'income', category_id: 'c-x' }),
    ];
    expect(filterEntries(list, new Set(['c-m'])).map((e) => e.id)).toEqual(['1', '3']);
  });
});

describe('ano até agora', () => {
  it('lista meses de janeiro até o escolhido', () => {
    expect(yearToDateMonths('2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(yearToDateMonths('2026-01')).toEqual(['2026-01']);
  });

  it('acumula, compara com o ano anterior e projeta pelos meses fechados', () => {
    const cur = [month('2026-01', 500000, 100000, 50000), month('2026-02', 500000, 120000, 30000), month('2026-03', 500000, 40000, 0)];
    const prev = [month('2025-01', 400000, 80000, 20000), month('2025-02', 400000, 80000, 20000), month('2025-03', 400000, 80000, 20000)];
    const y = yearToDate(cur, prev, '2026-03', null);
    expect(y).toMatchObject({ year: '2026', months: 3, income_cents: 1500000, expense_cents: 340000, result_cents: 1160000 });
    expect(y.last_year).toEqual({ income_cents: 1200000, expense_cents: 300000, result_cents: 900000 });
    expect(y.rows.map((r) => r.cumulative_expense_cents)).toEqual([150000, 300000, 340000]);
    expect(y.rows[1]!.last_year_cumulative_expense_cents).toBe(200000);
    expect(y.avg_expense_cents).toBe(150000);
    expect(y.projected_year_expense_cents).toBe(1800000);
    expect(y.projected_year_result_cents).toBe(4200000);
    expect(y.categories[0]).toMatchObject({ key: 'c-m', total_cents: 260000, last_year_cents: 240000 });
  });

  it('com filtro muda só a despesa; resultado segue completo', () => {
    const cur = [month('2026-01', 500000, 100000, 50000)];
    const y = yearToDate(cur, [], '2026-05', new Set(['c-l']));
    expect(y.expense_cents).toBe(50000);
    expect(y.result_cents).toBe(350000);
    expect(y.categories.map((c) => c.key)).toEqual(['c-l']);
    expect(y.last_year.expense_cents).toBe(0);
  });
});
