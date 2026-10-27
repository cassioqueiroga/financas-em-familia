/**
 * Análises aprofundadas (sem IA, sem migração).
 *
 * Modelos de referência, adaptados ao que o app registra:
 * - Índice de saúde financeira inspirado no FinHealth Score (Financial Health
 *   Network): pilares Gastar, Poupar, Dívidas e Organização, 0 a 100 cada.
 * - Regra 50-30-20 (necessidades, estilo de vida, poupança) sobre a receita.
 * - Despesas recorrentes detectadas e "para onde foi o dinheiro", como nos
 *   relatórios de fluxo de caixa de apps como Monarch e YNAB.
 *
 * Despesa do mês segue a mesma regra do resumo (D19): lançamentos de despesa
 * efetivados com data no mês + parcelas de cartão cuja fatura é do mês.
 * Pagamento de fatura e transferências nunca contam.
 */
import { addMonths, monthBounds } from '@/lib/dates';
import type { Category, Entry, MonthlySummary } from '@/features/finance/types';
import type { Analysis } from './analysis';

// ---------------------------------------------------------------------------
// Grupos 50-30-20
// ---------------------------------------------------------------------------
export type SpendGroup = 'essential' | 'lifestyle' | 'unclassified';

export const GROUP_LABEL: Record<SpendGroup, string> = {
  essential: 'Necessidades',
  lifestyle: 'Estilo de vida',
  unclassified: 'Sem grupo',
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

/** Classificação pelas categorias padrão do app; categorias criadas pelo casal ficam "sem grupo". */
const GROUP_BY_NAME: Record<string, SpendGroup> = {
  moradia: 'essential',
  mercado: 'essential',
  transporte: 'essential',
  saude: 'essential',
  educacao: 'essential',
  'contas e servicos': 'essential',
  'impostos e taxas': 'essential',
  pets: 'essential',
  'alimentacao fora': 'lifestyle',
  lazer: 'lifestyle',
  vestuario: 'lifestyle',
  assinaturas: 'lifestyle',
  presentes: 'lifestyle',
  'outras despesas': 'lifestyle',
};

export function groupOf(categoryName: string | null): SpendGroup {
  if (!categoryName) return 'unclassified';
  return GROUP_BY_NAME[normalize(categoryName)] ?? 'unclassified';
}

export interface BudgetSplit {
  income_cents: number;
  essential_cents: number;
  lifestyle_cents: number;
  unclassified_cents: number;
  /** Receita − despesas (pode ser negativa). */
  savings_cents: number;
}

export function splitByGroup(summary: Pick<MonthlySummary, 'income_cents' | 'expense_cents' | 'result_cents' | 'expenses_by_category'>): BudgetSplit {
  const split = { essential: 0, lifestyle: 0, unclassified: 0 };
  for (const c of summary.expenses_by_category) split[groupOf(c.name)] += c.total_cents;
  return {
    income_cents: summary.income_cents,
    essential_cents: split.essential,
    lifestyle_cents: split.lifestyle,
    unclassified_cents: split.unclassified,
    savings_cents: summary.result_cents,
  };
}

export function averageSplit(splits: BudgetSplit[]): BudgetSplit | null {
  if (splits.length === 0) return null;
  const avg = (k: keyof BudgetSplit) => Math.round(splits.reduce((s, x) => s + x[k], 0) / splits.length);
  return {
    income_cents: avg('income_cents'),
    essential_cents: avg('essential_cents'),
    lifestyle_cents: avg('lifestyle_cents'),
    unclassified_cents: avg('unclassified_cents'),
    savings_cents: avg('savings_cents'),
  };
}

// ---------------------------------------------------------------------------
// Índice de saúde financeira
// ---------------------------------------------------------------------------
export interface HealthPillar {
  key: 'spend' | 'save' | 'borrow' | 'organize';
  label: string;
  /** 0 a 100; null quando faltam dados para calcular. */
  score: number | null;
  basis: string;
}

export interface HealthScore {
  score: number | null;
  band: 'healthy' | 'coping' | 'vulnerable' | null;
  pillars: HealthPillar[];
}

export const BAND_LABEL: Record<NonNullable<HealthScore['band']>, string> = {
  healthy: 'Saudável',
  coping: 'Em equilíbrio',
  vulnerable: 'Vulnerável',
};

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const pct = (f: number) => `${Math.round(f * 100)}%`;

export function healthScore(a: Analysis, last: MonthlySummary): HealthScore {
  const rate = a.averages.savings_rate;
  const nextCard = a.future[1]?.remaining_cents ?? 0;
  const income = a.averages.income_cents;
  const categorized = last.expense_cents > 0
    ? 1 - (last.expenses_by_category.find((c) => c.category_id === null)?.total_cents ?? 0) / last.expense_cents
    : null;
  const closed = a.series.filter((p) => !p.partial);
  const activeMonths = closed.length;
  const withEntries = closed.filter((p) => p.income_cents > 0 || p.expense_cents > 0).length;
  const regular = activeMonths > 0 ? withEntries / activeMonths : null;

  const pillars: HealthPillar[] = [
    {
      key: 'spend',
      label: 'Gastar menos do que ganha',
      // −10% de poupança = 0; +20% = 100.
      score: rate === null ? null : clamp(((rate + 0.1) / 0.3) * 100),
      basis: rate === null ? 'Sem receita nos meses fechados.' : `Poupança média de ${pct(rate)} da receita (meta: 20%).`,
    },
    {
      key: 'save',
      label: 'Reserva de emergência',
      score: a.reserve_months === null ? null : clamp((a.reserve_months / 6) * 100),
      basis:
        a.reserve_months === null
          ? 'Sem despesa média para comparar.'
          : `Saldo disponível cobre ${Math.max(a.reserve_months, 0).toFixed(1).replace('.', ',')} meses de despesa (meta: 6).`,
    },
    {
      key: 'borrow',
      label: 'Dívidas sob controle',
      // Fatura do próximo mês: até 10% da receita = 100; 50% ou mais = 0.
      score: income > 0 ? clamp(((0.5 - nextCard / income) / 0.4) * 100) : null,
      basis: income > 0 ? `Fatura do próximo mês leva ${pct(nextCard / income)} da receita média (ideal: até 10%).` : 'Sem receita média para comparar.',
    },
    {
      key: 'organize',
      label: 'Organização',
      score: categorized === null && regular === null ? null : clamp(((categorized ?? 1) * 0.6 + (regular ?? 1) * 0.4) * 100),
      basis: `${categorized === null ? 'Sem despesas no mês' : `${pct(categorized)} das despesas do mês com categoria`}; ${withEntries} de ${activeMonths} meses fechados com lançamentos.`,
    },
  ];
  const known = pillars.filter((p) => p.score !== null);
  const score = known.length >= 2 ? Math.round(known.reduce((s, p) => s + p.score!, 0) / known.length) : null;
  const band = score === null ? null : score >= 80 ? 'healthy' : score >= 40 ? 'coping' : 'vulnerable';
  return { score, band, pillars };
}

// ---------------------------------------------------------------------------
// Lançamentos: despesas do mês, recorrências, ritmo
// ---------------------------------------------------------------------------
/** Despesas que contam no mês AAAA-MM (mesma regra do resumo). */
export function monthExpenses(entries: Entry[], month: string): Entry[] {
  const { from, to } = monthBounds(month);
  return entries.filter(
    (e) =>
      e.status === 'posted' &&
      ((e.kind === 'expense' && e.occurred_on >= from && e.occurred_on <= to) ||
        (e.kind === 'card_charge' && e.statement_month?.slice(0, 7) === month)),
  );
}

export function monthIncomes(entries: Entry[], month: string): Entry[] {
  const { from, to } = monthBounds(month);
  return entries.filter((e) => e.status === 'posted' && e.kind === 'income' && e.occurred_on >= from && e.occurred_on <= to);
}

/** Dia (1..31) em que a despesa pesa no mês: a data, ou o dia 1 para parcela lançada antes. */
function dayInMonth(e: Entry, month: string): number {
  return e.occurred_on.slice(0, 7) === month ? Number(e.occurred_on.slice(8, 10)) : 1;
}

/** Gasto acumulado por dia do mês (índice 0 = dia 1). */
export function cumulativeByDay(entries: Entry[], month: string): number[] {
  const days = Number(monthBounds(month).to.slice(8, 10));
  const daily = new Array<number>(days).fill(0);
  for (const e of monthExpenses(entries, month)) daily[dayInMonth(e, month) - 1]! += e.amount_cents;
  let acc = 0;
  return daily.map((v) => (acc += v));
}

export interface Projection {
  spent_cents: number;
  pending_cents: number;
  projected_cents: number;
  elapsed_days: number;
  days_in_month: number;
}

/** Projeção simples do mês em andamento: ritmo diário até hoje + contas a pagar já agendadas. */
export function projectMonth(cumulative: number[], todayDay: number, pendingExpense: number): Projection {
  const days = cumulative.length;
  const elapsed = Math.max(1, Math.min(todayDay, days));
  const spent = cumulative[elapsed - 1] ?? 0;
  return {
    spent_cents: spent,
    pending_cents: pendingExpense,
    projected_cents: Math.round((spent / elapsed) * days) + pendingExpense,
    elapsed_days: elapsed,
    days_in_month: days,
  };
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Gasto por dia da semana, só de despesas com data no próprio mês. */
export function byWeekday(entries: Entry[], month: string): { label: string; total_cents: number }[] {
  const totals = new Array<number>(7).fill(0);
  for (const e of monthExpenses(entries, month)) {
    if (e.occurred_on.slice(0, 7) !== month) continue;
    const [y, m, d] = e.occurred_on.split('-').map(Number) as [number, number, number];
    totals[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]! += e.amount_cents;
  }
  return WEEKDAYS.map((label, i) => ({ label, total_cents: totals[i]! }));
}

export function topExpenses(entries: Entry[], month: string, limit = 10): Entry[] {
  return [...monthExpenses(entries, month)].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, limit);
}

export interface Recurring {
  key: string;
  description: string;
  category_id: string | null;
  /** Valor típico (mediana) por mês. */
  monthly_cents: number;
  months: number;
  last_on: string;
}

/** Chave de agrupamento: descrição sem números, acentos e pontuação, primeiras 3 palavras. */
export function recurringKey(description: string): string {
  return normalize(description)
    .replace(/[\d*#/\\.,:;()[\]-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/**
 * Despesas que se repetem: mesma descrição (normalizada) em pelo menos 3
 * meses diferentes, com valor dentro de ±25% da mediana. Parcelas de cartão
 * ficam de fora (já aparecem nas faturas comprometidas).
 */
export function detectRecurring(entries: Entry[]): Recurring[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.status !== 'posted') continue;
    if (e.kind !== 'expense' && !(e.kind === 'card_charge' && (e.installment_count ?? 1) === 1)) continue;
    const key = recurringKey(e.description);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const byMonth = new Map<string, number>();
    for (const e of list) {
      const m = (e.kind === 'card_charge' ? e.statement_month : e.occurred_on)?.slice(0, 7) ?? e.occurred_on.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + e.amount_cents);
    }
    if (byMonth.size < 3) continue;
    const values = [...byMonth.values()];
    const med = median(values);
    if (med <= 0 || values.some((v) => Math.abs(v - med) > med * 0.25)) continue;
    const latest = list.reduce((a, b) => (b.occurred_on > a.occurred_on ? b : a));
    out.push({ key, description: latest.description, category_id: latest.category_id, monthly_cents: med, months: byMonth.size, last_on: latest.occurred_on });
  }
  return out.sort((a, b) => b.monthly_cents - a.monthly_cents);
}

// ---------------------------------------------------------------------------
// Comparação de categorias entre dois meses
// ---------------------------------------------------------------------------
export interface CategoryRow {
  key: string;
  name: string;
  group: SpendGroup;
  current_cents: number;
  previous_cents: number;
  share: number;
}

export function categoryRows(current: MonthlySummary, previous: MonthlySummary | null): CategoryRow[] {
  const prev = new Map((previous?.expenses_by_category ?? []).map((c) => [c.category_id ?? 'sem', c.total_cents]));
  const total = current.expense_cents || 1;
  return current.expenses_by_category.map((c) => ({
    key: c.category_id ?? 'sem',
    name: c.name ?? 'Sem categoria',
    group: groupOf(c.name),
    current_cents: c.total_cents,
    previous_cents: prev.get(c.category_id ?? 'sem') ?? 0,
    share: c.total_cents / total,
  }));
}

/** Intervalo de lançamentos para analisar o mês e o anterior (parcelas podem ter data no mês anterior). */
export function detailRange(month: string): { from: string; to: string } {
  return { from: monthBounds(addMonths(month, -2)).from, to: monthBounds(month).to };
}

export const categoryName = (categories: Category[], id: string | null) =>
  (id && categories.find((c) => c.id === id)?.name) || 'Sem categoria';
