/**
 * Análises do período (Etapa A — sem IA, sem migração).
 *
 * Regras:
 * - Tudo é derivado de `monthly_summary` (um por mês) e de `card_statements`
 *   (por cartão), as mesmas funções do painel do mês, sob as mesmas
 *   permissões: cada pessoa só analisa o que pode ver.
 * - Valores continuam em centavos inteiros. Percentuais e médias servem só
 *   para exibição e comparação; nunca viram lançamento.
 * - O mês de referência pode estar em andamento. Médias usam apenas meses
 *   fechados anteriores a ele, para não puxar a média para baixo.
 * - Os limites das regras do diagnóstico ficam em `THRESHOLDS`.
 */
import { addMonths } from '@/lib/dates';
import type { CardStatement, MonthlySummary } from '@/features/finance/types';

export const THRESHOLDS = {
  /** Poupança média abaixo disto (fração da receita) gera atenção. */
  lowSavingsRate: 0.1,
  /** Poupança média a partir disto é destacada como positiva. */
  goodSavingsRate: 0.2,
  /** Categoria acima da própria média nesta fração (0,3 = 30%) entra em alta. */
  categorySpike: 0.3,
  /** Diferença mínima, em centavos, para uma alta de categoria contar. */
  categorySpikeMinCents: 5000,
  /** Meses anteriores usados na média por categoria. */
  categoryBaselineMonths: 3,
  /** Faturas do próximo mês acima desta fração da receita média geram atenção. */
  cardCommitmentRate: 0.3,
  /** Reserva (meses de despesa cobertos pelo saldo disponível). */
  reserveCriticalMonths: 1,
  reserveLowMonths: 3,
  reserveGoodMonths: 6,
  /** Despesa sem categoria acima desta fração do total do mês gera atenção. */
  uncategorizedRate: 0.15,
  /** Crescimento da despesa média (3 meses recentes × 3 anteriores). */
  expenseGrowthRate: 0.1,
} as const;

export interface MonthPoint {
  month: string; // AAAA-MM
  income_cents: number;
  expense_cents: number;
  result_cents: number;
  /** Fração da receita que sobrou; null sem receita. */
  savings_rate: number | null;
  /** Mês ainda em andamento (posterior ou igual ao mês corrente). */
  partial: boolean;
}

export interface CategoryChange {
  key: string;
  name: string;
  current_cents: number;
  baseline_cents: number;
  /** Variação relativa à média; null quando não havia gasto antes. */
  change: number | null;
}

export interface FutureCommitment {
  month: string; // AAAA-MM do vencimento
  remaining_cents: number;
}

export type InsightLevel = 'alert' | 'attention' | 'positive' | 'info';

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  detail: string;
  /** Sugestão prática, quando houver. */
  suggestion?: string;
}

export interface Analysis {
  reference: string;
  series: MonthPoint[];
  completeMonths: MonthPoint[];
  averages: { income_cents: number; expense_cents: number; result_cents: number; savings_rate: number | null };
  categories: CategoryChange[];
  future: FutureCommitment[];
  available_cents: number;
  card_debt_cents: number;
  /** Meses de despesa média cobertos pelo saldo disponível; null sem despesa. */
  reserve_months: number | null;
  insights: Insight[];
}

const mean = (values: number[]) => (values.length === 0 ? 0 : Math.round(values.reduce((s, v) => s + v, 0) / values.length));

export function savingsRate(income: number, result: number): number | null {
  return income > 0 ? result / income : null;
}

/** Meses AAAA-MM terminando em `reference`, do mais antigo para o mais novo. */
export function monthRange(reference: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(reference, i - count + 1));
}

const categoryKey = (c: { category_id: string | null }) => c.category_id ?? 'sem';

export function compareCategories(current: MonthlySummary, baseline: MonthlySummary[]): CategoryChange[] {
  const names = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const s of baseline) {
    for (const c of s.expenses_by_category) {
      const key = categoryKey(c);
      names.set(key, c.name ?? 'Sem categoria');
      totals.set(key, (totals.get(key) ?? 0) + c.total_cents);
    }
  }
  const currentTotals = new Map<string, number>();
  for (const c of current.expenses_by_category) {
    const key = categoryKey(c);
    names.set(key, c.name ?? 'Sem categoria');
    currentTotals.set(key, c.total_cents);
  }
  const divisor = Math.max(baseline.length, 1);
  return [...names.keys()]
    .map((key) => {
      const current_cents = currentTotals.get(key) ?? 0;
      const baseline_cents = Math.round((totals.get(key) ?? 0) / divisor);
      return {
        key,
        name: names.get(key) ?? 'Sem categoria',
        current_cents,
        baseline_cents,
        change: baseline_cents > 0 ? (current_cents - baseline_cents) / baseline_cents : null,
      };
    })
    .sort((a, b) => b.current_cents - a.current_cents || b.baseline_cents - a.baseline_cents);
}

/** Saldo a pagar das faturas por mês de vencimento, de `from` até `from + months - 1`. */
export function futureCommitments(statements: CardStatement[], from: string, months: number): FutureCommitment[] {
  const range = monthRange(addMonths(from, months - 1), months);
  const byMonth = new Map(range.map((m) => [m, 0]));
  for (const s of statements) {
    const month = s.due_date.slice(0, 7);
    if (byMonth.has(month)) byMonth.set(month, (byMonth.get(month) ?? 0) + s.remaining_cents);
  }
  return range.map((month) => ({ month, remaining_cents: byMonth.get(month) ?? 0 }));
}

export const formatPercent = (fraction: number) => `${Math.round(fraction * 100)}%`;

const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Math.round(value / 100));

const hasActivity = (p: MonthPoint) => p.income_cents > 0 || p.expense_cents > 0;

/**
 * Monta a análise. `summaries` deve vir em ordem cronológica e terminar no
 * mês de referência; `today` é o mês corrente no fuso do espaço.
 */
export function analyze(input: {
  summaries: MonthlySummary[];
  statements: CardStatement[];
  today: string;
}): Analysis {
  const { summaries, statements, today } = input;
  const last = summaries.at(-1);
  if (!last) throw new RangeError('Nenhum mês para analisar');
  const reference = last.month.slice(0, 7);

  const series: MonthPoint[] = summaries.map((s) => {
    const month = s.month.slice(0, 7);
    return {
      month,
      income_cents: s.income_cents,
      expense_cents: s.expense_cents,
      result_cents: s.result_cents,
      savings_rate: savingsRate(s.income_cents, s.result_cents),
      partial: month >= today,
    };
  });
  const refPoint = series.at(-1)!;
  // Meses fechados antes da referência e com algum movimento (meses vazios antes do uso real distorceriam a média).
  const completeMonths = series.slice(0, -1).filter((p) => !p.partial && hasActivity(p));

  const avgIncome = mean(completeMonths.map((p) => p.income_cents));
  const avgExpense = mean(completeMonths.map((p) => p.expense_cents));
  const avgResult = mean(completeMonths.map((p) => p.result_cents));
  const averages = { income_cents: avgIncome, expense_cents: avgExpense, result_cents: avgResult, savings_rate: savingsRate(avgIncome, avgResult) };

  const completeSet = new Set(completeMonths.map((p) => p.month));
  const baseline = summaries.slice(0, -1).filter((s) => completeSet.has(s.month.slice(0, 7))).slice(-THRESHOLDS.categoryBaselineMonths);
  const categories = compareCategories(last, baseline);

  const future = futureCommitments(statements, today, 6);
  const reserveBase = avgExpense > 0 ? avgExpense : refPoint.partial ? 0 : refPoint.expense_cents;
  const reserve_months = reserveBase > 0 ? last.available_cents / reserveBase : null;

  const analysis: Analysis = {
    reference,
    series,
    completeMonths,
    averages,
    categories,
    future,
    available_cents: last.available_cents,
    card_debt_cents: last.card_debt_cents,
    reserve_months,
    insights: [],
  };
  analysis.insights = diagnose(analysis, last);
  return analysis;
}

const LEVEL_ORDER: Record<InsightLevel, number> = { alert: 0, attention: 1, info: 2, positive: 3 };

export function diagnose(a: Analysis, last: MonthlySummary): Insight[] {
  const out: Insight[] = [];
  const ref = a.series.at(-1)!;
  const T = THRESHOLDS;

  if (a.completeMonths.length < 2) {
    out.push({
      id: 'poucos-dados',
      level: 'info',
      title: 'Ainda há poucos meses registrados',
      detail: `A análise fica mais confiável com pelo menos 2 meses fechados de lançamentos; hoje há ${a.completeMonths.length}.`,
      suggestion: 'Importe extratos antigos (OFX/CSV) para ter um histórico de comparação.',
    });
  }

  // 1. Resultado do mês de referência.
  if (ref.result_cents < 0 && hasActivity(ref)) {
    out.push({
      id: 'resultado-negativo',
      level: 'alert',
      title: ref.partial ? 'O mês em andamento já está no vermelho' : 'O mês fechou no vermelho',
      detail: `As despesas superaram as receitas em ${brl(-ref.result_cents)}.`,
      suggestion: 'Veja abaixo as categorias em alta e escolha uma ou duas para segurar até o fim do mês.',
    });
  }

  // 2. Meses seguidos no vermelho (só meses fechados).
  let streak = 0;
  for (const p of [...a.completeMonths].reverse()) {
    if (p.result_cents < 0) streak += 1;
    else break;
  }
  if (streak >= 2) {
    out.push({
      id: 'vermelho-seguido',
      level: 'alert',
      title: `${streak} meses seguidos gastando mais do que entrou`,
      detail: 'Um déficit repetido costuma ser coberto por cartão ou reserva e vira dívida.',
      suggestion: 'Defina um teto de gasto mensal igual à receita média menos o que quer poupar.',
    });
  }

  // 3. Taxa de poupança média.
  const rate = a.averages.savings_rate;
  if (rate !== null && a.completeMonths.length >= 2) {
    if (rate < T.lowSavingsRate) {
      const target = Math.round(a.averages.income_cents * T.lowSavingsRate);
      out.push({
        id: 'poupanca-baixa',
        level: 'attention',
        title: `Vocês poupam em média ${formatPercent(rate)} da receita`,
        detail: `A referência mínima usada aqui é ${formatPercent(T.lowSavingsRate)}.`,
        suggestion: `Separar ${brl(target)} logo que a receita entrar (transferência para a poupança) chega a ${formatPercent(T.lowSavingsRate)}.`,
      });
    } else if (rate >= T.goodSavingsRate) {
      out.push({
        id: 'poupanca-boa',
        level: 'positive',
        title: `Boa taxa de poupança: ${formatPercent(rate)} da receita`,
        detail: `Média de ${brl(a.averages.result_cents)} por mês nos meses fechados analisados.`,
      });
    }
  }

  // 4. Tendência da despesa (3 meses recentes × 3 anteriores).
  if (a.completeMonths.length >= 6) {
    const recent = mean(a.completeMonths.slice(-3).map((p) => p.expense_cents));
    const before = mean(a.completeMonths.slice(-6, -3).map((p) => p.expense_cents));
    if (before > 0 && (recent - before) / before > T.expenseGrowthRate) {
      out.push({
        id: 'despesa-crescendo',
        level: 'attention',
        title: `A despesa média subiu ${formatPercent((recent - before) / before)}`,
        detail: `Últimos 3 meses: ${brl(recent)} por mês; 3 meses antes: ${brl(before)}.`,
        suggestion: 'Confira se entrou alguma assinatura ou parcela nova nesse período.',
      });
    }
  }

  // 5. Categorias em alta.
  const spikes = a.categories
    .filter((c) => c.baseline_cents > 0 && c.change !== null && c.change > T.categorySpike && c.current_cents - c.baseline_cents >= T.categorySpikeMinCents)
    .sort((x, y) => y.current_cents - y.baseline_cents - (x.current_cents - x.baseline_cents))
    .slice(0, 3);
  for (const c of spikes) {
    out.push({
      id: `alta-${c.key}`,
      level: 'attention',
      title: `${c.name}: ${formatPercent(c.change!)} acima da média`,
      detail: `${brl(c.current_cents)} no mês contra ${brl(c.baseline_cents)} de média${ref.partial ? ' (e o mês ainda não acabou)' : ''}.`,
      suggestion: `Voltar à média liberaria ${brl(c.current_cents - c.baseline_cents)} por mês.`,
    });
  }

  // 6. Despesa sem categoria.
  const uncategorized = last.expenses_by_category.find((c) => c.category_id === null)?.total_cents ?? 0;
  if (last.expense_cents > 0 && uncategorized / last.expense_cents > T.uncategorizedRate) {
    out.push({
      id: 'sem-categoria',
      level: 'info',
      title: `${formatPercent(uncategorized / last.expense_cents)} das despesas do mês estão sem categoria`,
      detail: `São ${brl(uncategorized)} que ficam fora da comparação por categoria.`,
      suggestion: 'Em Lançamentos, edite os itens importados e escolha a categoria.',
    });
  }

  // 7. Faturas já comprometidas no próximo mês.
  const next = a.future[1];
  if (next && a.averages.income_cents > 0 && next.remaining_cents / a.averages.income_cents > T.cardCommitmentRate) {
    out.push({
      id: 'cartao-comprometido',
      level: 'attention',
      title: `As faturas do próximo mês já levam ${formatPercent(next.remaining_cents / a.averages.income_cents)} da receita média`,
      detail: `${brl(next.remaining_cents)} já lançados, antes de qualquer compra nova.`,
      suggestion: 'Evite novos parcelamentos até essa fatia cair abaixo de 30%.',
    });
  }

  // 8. Reserva de emergência (saldo negativo vale mesmo sem média de despesa).
  if (a.available_cents <= 0 && (a.reserve_months !== null || a.available_cents < 0)) {
    out.push({
      id: 'reserva-negativa',
      level: 'alert',
      title: 'O saldo disponível nas contas está zerado ou negativo',
      detail: `Saldo somado das contas ativas (sem cartões): ${brl(a.available_cents)}.`,
      suggestion: 'Priorize cobrir o negativo antes de novas despesas; cheque especial costuma ser o crédito mais caro.',
    });
  } else if (a.reserve_months !== null) {
    const months = a.reserve_months;
    const label = `${months.toFixed(1).replace('.', ',')} ${months >= 0.95 && months < 1.05 ? 'mês' : 'meses'}`;
    if (months < T.reserveLowMonths) {
      const gap = Math.max(Math.round(a.averages.expense_cents * T.reserveLowMonths) - a.available_cents, 0);
      out.push({
        id: 'reserva-baixa',
        level: months < T.reserveCriticalMonths ? 'alert' : 'attention',
        title: `O saldo disponível cobre ${label} de despesas`,
        detail: `A referência mínima é ${T.reserveLowMonths} meses; o ideal, ${T.reserveGoodMonths}.`,
        ...(gap > 0 && { suggestion: `Faltam cerca de ${brl(gap)} para chegar a ${T.reserveLowMonths} meses.` }),
      });
    } else if (months >= T.reserveGoodMonths) {
      out.push({
        id: 'reserva-boa',
        level: 'positive',
        title: `Reserva sólida: ${label} de despesas`,
        detail: 'Acima da referência de 6 meses; o excedente pode ir para investimentos de prazo maior.',
      });
    }
  }

  return out.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
}
