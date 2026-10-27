/**
 * Ano até agora (YTD) e filtro por categoria.
 *
 * YTD = janeiro até o mês escolhido, comparado com os mesmos meses do ano
 * anterior. O filtro de categorias vale só para o lado da despesa: receita,
 * resultado, índice de saúde e diagnóstico continuam com todos os dados.
 */
import { monthRange } from './analysis';
import type { Entry, MonthlySummary } from '@/features/finance/types';

/** Chaves de categoria selecionadas (`category_id` ou "sem"); null = todas. */
export type CategoryFilter = ReadonlySet<string> | null;

export const categoryKeyOf = (id: string | null) => id ?? 'sem';

export function filteredExpense(s: Pick<MonthlySummary, 'expense_cents' | 'expenses_by_category'>, filter: CategoryFilter): number {
  if (!filter) return s.expense_cents;
  return s.expenses_by_category.filter((c) => filter.has(categoryKeyOf(c.category_id))).reduce((sum, c) => sum + c.total_cents, 0);
}

export function filterSummary(s: MonthlySummary, filter: CategoryFilter): MonthlySummary {
  if (!filter) return s;
  return {
    ...s,
    expense_cents: filteredExpense(s, filter),
    expenses_by_category: s.expenses_by_category.filter((c) => filter.has(categoryKeyOf(c.category_id))),
  };
}

export function filterEntries(entries: Entry[], filter: CategoryFilter): Entry[] {
  if (!filter) return entries;
  // Receitas não são filtradas; só despesas e parcelas de cartão.
  return entries.filter((e) => (e.kind !== 'expense' && e.kind !== 'card_charge') || filter.has(categoryKeyOf(e.category_id)));
}

/** Meses AAAA-MM de janeiro até `month`. */
export function yearToDateMonths(month: string): string[] {
  return monthRange(month, Number(month.slice(5, 7)));
}

export interface YtdRow {
  month: string;
  income_cents: number;
  expense_cents: number;
  cumulative_expense_cents: number;
  cumulative_result_cents: number;
  last_year_expense_cents: number;
  last_year_cumulative_expense_cents: number;
}

export interface YtdCategory {
  key: string;
  name: string;
  total_cents: number;
  last_year_cents: number;
  share: number;
}

export interface Ytd {
  year: string;
  income_cents: number;
  expense_cents: number;
  result_cents: number;
  last_year: { income_cents: number; expense_cents: number; result_cents: number };
  rows: YtdRow[];
  categories: YtdCategory[];
  /** Meses considerados: do primeiro com lançamentos (neste ano ou no anterior) até o escolhido. */
  months: number;
  /** Média mensal de despesa dos meses fechados do YTD; null sem meses fechados. */
  avg_expense_cents: number | null;
  /** Despesa do ano inteiro no ritmo dos meses fechados. */
  projected_year_expense_cents: number | null;
  projected_year_result_cents: number | null;
}

/**
 * `current` e `previous` em ordem cronológica, de janeiro até o mês escolhido
 * (do ano atual e do anterior). `today` (AAAA-MM) marca o mês em andamento.
 */
export function yearToDate(current: MonthlySummary[], previous: MonthlySummary[], today: string, filter: CategoryFilter): Ytd {
  const year = current[0]?.month.slice(0, 4) ?? today.slice(0, 4);
  // Meses antes do começo do uso (sem nada neste ano nem no anterior) ficam de fora de linhas e médias.
  const active = (x: MonthlySummary | undefined) => !!x && (x.income_cents > 0 || x.expense_cents > 0);
  const first = current.findIndex((x, i) => active(x) || active(previous[i]));
  const start = first === -1 ? current.length : first;
  let cumExpense = 0;
  let cumResult = 0;
  let cumLast = 0;
  const rows = current.slice(start).map((s, j) => {
    const i = j + start;
    const expense = filteredExpense(s, filter);
    const lastExpense = previous[i] ? filteredExpense(previous[i], filter) : 0;
    cumExpense += expense;
    cumResult += s.income_cents - s.expense_cents;
    cumLast += lastExpense;
    return {
      month: s.month.slice(0, 7),
      income_cents: s.income_cents,
      expense_cents: expense,
      cumulative_expense_cents: cumExpense,
      cumulative_result_cents: cumResult,
      last_year_expense_cents: lastExpense,
      last_year_cumulative_expense_cents: cumLast,
    };
  });

  const sum = (list: MonthlySummary[], f: (s: MonthlySummary) => number) => list.reduce((acc, s) => acc + f(s), 0);
  const income = sum(current, (s) => s.income_cents);
  const lastIncome = sum(previous, (s) => s.income_cents);
  const lastExpense = sum(previous, (s) => filteredExpense(s, filter));

  const names = new Map<string, string>();
  const totals = new Map<string, number>();
  const lastTotals = new Map<string, number>();
  for (const [list, target] of [
    [current, totals],
    [previous, lastTotals],
  ] as const) {
    for (const s of list) {
      for (const c of s.expenses_by_category) {
        const key = categoryKeyOf(c.category_id);
        if (filter && !filter.has(key)) continue;
        names.set(key, c.name ?? 'Sem categoria');
        target.set(key, (target.get(key) ?? 0) + c.total_cents);
      }
    }
  }
  const categories = [...names.keys()]
    .map((key) => ({
      key,
      name: names.get(key)!,
      total_cents: totals.get(key) ?? 0,
      last_year_cents: lastTotals.get(key) ?? 0,
      share: cumExpense > 0 ? (totals.get(key) ?? 0) / cumExpense : 0,
    }))
    .sort((a, b) => b.total_cents - a.total_cents || b.last_year_cents - a.last_year_cents);

  const closedSummaries = current.filter((x) => x.month.slice(0, 7) < today && active(x));
  const closed = rows.filter((r) => closedSummaries.some((x) => x.month.slice(0, 7) === r.month));
  const avg = closed.length > 0 ? Math.round(closed.reduce((s, r) => s + r.expense_cents, 0) / closed.length) : null;
  const closedResult = closedSummaries.reduce((s, x) => s + x.result_cents, 0);
  const avgResult = closed.length > 0 ? closedResult / closed.length : null;

  return {
    year,
    months: rows.length,
    income_cents: income,
    expense_cents: cumExpense,
    result_cents: cumResult,
    last_year: { income_cents: lastIncome, expense_cents: lastExpense, result_cents: sum(previous, (s) => s.income_cents - s.expense_cents) },
    rows,
    categories,
    avg_expense_cents: avg,
    projected_year_expense_cents: avg === null ? null : avg * 12,
    projected_year_result_cents: avgResult === null ? null : Math.round(avgResult * 12),
  };
}
