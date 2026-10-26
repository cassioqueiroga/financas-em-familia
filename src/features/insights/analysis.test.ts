import { describe, expect, it } from 'vitest';
import { makeSummary } from '@/test/fakes';
import type { CardStatement, MonthlySummary } from '@/features/finance/types';
import { analyze, compareCategories, futureCommitments, monthRange, savingsRate } from './analysis';

const month = (m: string, income: number, expense: number, extra: Partial<MonthlySummary> = {}) =>
  makeSummary({ month: `${m}-01`, income_cents: income, expense_cents: expense, result_cents: income - expense, ...extra });

const statement = (due: string, remaining: number): CardStatement => ({
  statement_month: `${due.slice(0, 7)}-01`,
  closing_date: due,
  due_date: due,
  total_cents: remaining,
  paid_cents: 0,
  remaining_cents: remaining,
  status: 'open',
});

describe('monthRange', () => {
  it('termina no mês de referência e atravessa o ano', () => {
    expect(monthRange('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('savingsRate', () => {
  it('é nula sem receita', () => {
    expect(savingsRate(0, -100)).toBeNull();
    expect(savingsRate(1000, 250)).toBe(0.25);
  });
});

describe('compareCategories', () => {
  it('compara o mês com a média e trata sem categoria', () => {
    const cur = month('2026-04', 0, 0, {
      expenses_by_category: [
        { category_id: 'c-1', name: 'Mercado', total_cents: 150000 },
        { category_id: null, name: null, total_cents: 2000 },
      ],
    });
    const base = [
      month('2026-02', 0, 0, { expenses_by_category: [{ category_id: 'c-1', name: 'Mercado', total_cents: 100000 }] }),
      month('2026-03', 0, 0, { expenses_by_category: [{ category_id: 'c-1', name: 'Mercado', total_cents: 100000 }, { category_id: 'c-2', name: 'Lazer', total_cents: 40000 }] }),
    ];
    const result = compareCategories(cur, base);
    expect(result[0]).toMatchObject({ key: 'c-1', current_cents: 150000, baseline_cents: 100000, change: 0.5 });
    expect(result.find((c) => c.key === 'c-2')).toMatchObject({ current_cents: 0, baseline_cents: 20000, change: -1 });
    expect(result.find((c) => c.key === 'sem')).toMatchObject({ name: 'Sem categoria', change: null });
  });
});

describe('futureCommitments', () => {
  it('agrupa o saldo a pagar pelo mês de vencimento', () => {
    const r = futureCommitments([statement('2026-05-10', 1000), statement('2026-05-20', 500), statement('2026-07-10', 300), statement('2026-01-10', 999)], '2026-04', 6);
    expect(r.map((f) => f.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(r[1]!.remaining_cents).toBe(1500);
    expect(r[3]!.remaining_cents).toBe(300);
    expect(r.reduce((s, f) => s + f.remaining_cents, 0)).toBe(1800);
  });
});

describe('analyze', () => {
  it('exclui o mês em andamento e meses vazios das médias', () => {
    const a = analyze({
      summaries: [month('2026-01', 0, 0), month('2026-02', 1000000, 800000), month('2026-03', 1000000, 600000), month('2026-04', 100000, 900000)],
      statements: [],
      today: '2026-04',
    });
    expect(a.completeMonths.map((p) => p.month)).toEqual(['2026-02', '2026-03']);
    expect(a.averages.income_cents).toBe(1000000);
    expect(a.averages.expense_cents).toBe(700000);
    expect(a.averages.savings_rate).toBe(0.3);
    expect(a.series.at(-1)!.partial).toBe(true);
  });

  it('aponta mês no vermelho, poupança baixa e reserva baixa, alertas primeiro', () => {
    const a = analyze({
      summaries: [month('2026-01', 1000000, 950000), month('2026-02', 1000000, 980000), month('2026-03', 1000000, 1100000, { available_cents: 1500000 })],
      statements: [],
      today: '2026-05',
    });
    const ids = a.insights.map((i) => i.id);
    expect(ids).toContain('resultado-negativo');
    expect(ids).toContain('poupanca-baixa');
    expect(ids).toContain('reserva-baixa');
    expect(a.insights[0]!.level).toBe('alert');
    expect(a.reserve_months).toBeCloseTo(1500000 / 965000);
  });

  it('detecta dois meses fechados seguidos no vermelho', () => {
    const a = analyze({
      summaries: [month('2026-01', 500000, 600000), month('2026-02', 500000, 700000), month('2026-03', 0, 0)],
      statements: [],
      today: '2026-03',
    });
    expect(a.insights.find((i) => i.id === 'vermelho-seguido')?.title).toMatch(/^2 meses seguidos/);
  });

  it('destaca categoria em alta só acima do limite e do valor mínimo', () => {
    const cat = (total: number, other = 1000) => ({
      expenses_by_category: [
        { category_id: 'c-1', name: 'Restaurantes', total_cents: total },
        { category_id: 'c-2', name: 'Farmácia', total_cents: other },
      ],
    });
    const a = analyze({
      summaries: [
        month('2026-01', 1000000, 500000, cat(50000)),
        month('2026-02', 1000000, 500000, cat(50000)),
        month('2026-03', 1000000, 500000, cat(50000)),
        month('2026-04', 1000000, 500000, cat(90000, 2000)),
      ],
      statements: [],
      today: '2026-05',
    });
    const spikes = a.insights.filter((i) => i.id.startsWith('alta-'));
    // Farmácia dobrou, mas a diferença (R$ 10) fica abaixo do mínimo.
    expect(spikes.map((i) => i.id)).toEqual(['alta-c-1']);
    expect(spikes[0]!.title).toBe('Restaurantes: 80% acima da média');
  });

  it('reconhece boa poupança e reserva sólida, e cartão comprometido', () => {
    const a = analyze({
      summaries: [month('2026-01', 1000000, 700000), month('2026-02', 1000000, 700000), month('2026-03', 1000000, 700000, { available_cents: 5000000, card_debt_cents: 400000 })],
      statements: [statement('2026-04-10', 400000)],
      today: '2026-03',
    });
    const ids = a.insights.map((i) => i.id);
    expect(ids).toContain('poupanca-boa');
    expect(ids).toContain('reserva-boa');
    expect(ids).toContain('cartao-comprometido');
    expect(a.insights.at(-1)!.level).toBe('positive');
  });

  it('avisa quando o saldo disponível é negativo e quando há poucos dados', () => {
    const a = analyze({ summaries: [month('2026-03', 100000, 50000, { available_cents: -1000 })], statements: [], today: '2026-03' });
    const ids = a.insights.map((i) => i.id);
    expect(ids).toContain('poucos-dados');
    expect(ids).toContain('reserva-negativa');
  });

  it('aponta despesa sem categoria acima de 15%', () => {
    const a = analyze({
      summaries: [month('2026-03', 0, 100000, { expenses_by_category: [{ category_id: null, name: null, total_cents: 20000 }] })],
      statements: [],
      today: '2026-04',
    });
    expect(a.insights.find((i) => i.id === 'sem-categoria')?.title).toBe('20% das despesas do mês estão sem categoria');
  });
});
