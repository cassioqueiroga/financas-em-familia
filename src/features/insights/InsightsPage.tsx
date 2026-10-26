import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useServices } from '@/app/services';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StatusViews';
import { currentMonth, formatMonth } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { useFinance } from '@/features/finance/FinanceContext';
import { MonthPicker, PageHeader, SpaceGate } from '@/features/finance/shared';
import { analyze, formatPercent, monthRange, type Analysis, type Insight, type InsightLevel } from './analysis';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; analysis: Analysis };

const PERIODS = [6, 12] as const;

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "outubro de 2026" → "Outubro de 2026" (CSS capitalize também afetaria "de"). */
const monthTitle = (month: string) => formatMonth(month).replace(/^./, (c) => c.toUpperCase());

const shortMonth = (month: string) => `${SHORT_MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`;

export function InsightsPage() {
  return (
    <section aria-labelledby="titulo-analises" className="space-y-6">
      <PageHeader
        id="titulo-analises"
        title="Análises"
        description="Acompanhamento dos últimos meses, calculado a partir dos lançamentos que você pode ver. Nenhum dado sai do app."
      />
      <SpaceGate>
        <Insights />
      </SpaceGate>
    </section>
  );
}

function Insights() {
  const { finance } = useServices();
  const { active, data } = useFinance();
  const today = currentMonth(active?.timezone);
  const [reference, setReference] = useState(today);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(6);
  const [state, setState] = useState<State>({ status: 'loading' });
  const householdId = active?.id;
  const cardIds = data.accounts.filter((a) => a.kind === 'credit_card').map((a) => a.id).join(',');

  const load = useCallback(async (): Promise<State> => {
    if (!householdId) return { status: 'loading' };
    try {
      const [summaries, statements] = await Promise.all([
        Promise.all(monthRange(reference, period).map((m) => finance.monthlySummary(householdId, m))),
        Promise.all(cardIds ? cardIds.split(',').map((id) => finance.cardStatements(id)) : []),
      ]);
      return { status: 'ready', analysis: analyze({ summaries, statements: statements.flat(), today }) };
    } catch (err) {
      return { status: 'error', message: toUserMessage(err, 'carregar análises') };
    }
  }, [finance, householdId, reference, period, cardIds, today]);

  useEffect(() => {
    let alive = true;
    void load().then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período analisado">
          {PERIODS.map((p) => (
            <Button key={p} variant={p === period ? 'primary' : 'secondary'} aria-pressed={p === period} onClick={() => setPeriod(p)}>
              {p} meses
            </Button>
          ))}
        </div>
        <MonthPicker month={reference} onChange={setReference} />
      </div>
      {state.status === 'loading' && <LoadingState label="Calculando análises…" />}
      {state.status === 'error' && (
        <ErrorState
          message={state.message}
          action={
            <Button variant="secondary" onClick={() => void load().then(setState)}>
              Tentar de novo
            </Button>
          }
        />
      )}
      {state.status === 'ready' && <Report analysis={state.analysis} />}
    </div>
  );
}

function Report({ analysis: a }: { analysis: Analysis }) {
  const ref = a.series.at(-1)!;
  return (
    <>
      <Diagnosis insights={a.insights} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Receita média" hint="Meses fechados do período.">
          <Amount value={a.averages.income_cents} />
        </Tile>
        <Tile label="Despesa média" hint="Meses fechados do período.">
          <Amount value={a.averages.expense_cents} />
        </Tile>
        <Tile label="Poupança média" hint="Quanto da receita sobrou, em média.">
          {a.averages.savings_rate === null ? '—' : formatPercent(a.averages.savings_rate)}
        </Tile>
        <Tile label="Reserva de emergência" hint="Meses de despesa média cobertos pelo saldo disponível.">
          {a.reserve_months === null ? '—' : `${Math.max(a.reserve_months, 0).toFixed(1).replace('.', ',')} meses`}
        </Tile>
      </div>

      <Evolution analysis={a} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Categories analysis={a} partial={ref.partial} />
        <Future analysis={a} />
      </div>
    </>
  );
}

function Tile({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-sm text-ink/70">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{children}</p>
      {hint && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
    </div>
  );
}

const LEVEL_STYLE: Record<InsightLevel, { label: string; className: string }> = {
  alert: { label: 'Alerta', className: 'border-danger bg-danger/5' },
  attention: { label: 'Atenção', className: 'border-warning bg-warning/5' },
  info: { label: 'Informação', className: 'border-ink/20 bg-surface' },
  positive: { label: 'Ponto positivo', className: 'border-brand-500 bg-brand-500/5' },
};

function Diagnosis({ insights }: { insights: Insight[] }) {
  return (
    <section aria-labelledby="titulo-diagnostico" className="rounded-xl bg-white p-4 shadow-sm">
      <h2 id="titulo-diagnostico" className="font-semibold">
        Diagnóstico e sugestões
      </h2>
      <p className="mb-3 text-xs text-ink/60">Calculado por regras fixas sobre os números abaixo; não usa inteligência artificial.</p>
      {insights.length === 0 ? (
        <p className="text-sm text-ink/70">Nenhum ponto de atenção no período. Continue registrando os lançamentos.</p>
      ) : (
        <ul className="space-y-2">
          {insights.map((i) => (
            <li key={i.id} className={`rounded-lg border-l-4 p-3 text-sm ${LEVEL_STYLE[i.level].className}`}>
              <p className="font-semibold">
                <span className="sr-only">{LEVEL_STYLE[i.level].label}: </span>
                {i.title}
              </p>
              <p className="text-ink/80">{i.detail}</p>
              {i.suggestion && <p className="mt-1 text-ink/80">Sugestão: {i.suggestion}</p>}
              <p aria-hidden="true" className="mt-1 text-xs uppercase tracking-wide text-ink/50">
                {LEVEL_STYLE[i.level].label}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Evolution({ analysis: a }: { analysis: Analysis }) {
  const max = Math.max(...a.series.flatMap((p) => [p.income_cents, p.expense_cents]), 1);
  return (
    <section aria-labelledby="titulo-evolucao" className="rounded-xl bg-white p-4 shadow-sm">
      <h2 id="titulo-evolucao" className="font-semibold">
        Evolução mensal
      </h2>
      <p className="mb-3 flex flex-wrap gap-4 text-xs text-ink/70">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-brand-500" /> Receitas
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-danger" /> Despesas
        </span>
      </p>
      <div aria-hidden="true" className="flex h-40 items-end gap-2 overflow-x-auto border-b border-ink/10">
        {a.series.map((p) => (
          <div key={p.month} className="flex h-full min-w-8 flex-1 items-end justify-center gap-0.5">
            <div className="w-1/2 max-w-4 rounded-t bg-brand-500" style={{ height: `${(p.income_cents / max) * 100}%` }} />
            <div className="w-1/2 max-w-4 rounded-t bg-danger" style={{ height: `${(p.expense_cents / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-2 overflow-x-auto text-center text-[11px] text-ink/60">
        {a.series.map((p) => (
          <span key={p.month} className="min-w-8 flex-1">
            {shortMonth(p.month)}
            {p.partial ? '*' : ''}
          </span>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Receitas, despesas, resultado e poupança por mês</caption>
          <thead>
            <tr className="text-left text-ink/70">
              <th scope="col" className="py-1 pr-2 font-medium">Mês</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Receitas</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Despesas</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Resultado</th>
              <th scope="col" className="py-1 text-right font-medium">Poupança</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {[...a.series].reverse().map((p) => (
              <tr key={p.month}>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {monthTitle(p.month)}
                  {p.partial && <span className="text-ink/60"> (em andamento)</span>}
                </th>
                <td className="py-1 pr-2 text-right">
                  <Amount value={p.income_cents} />
                </td>
                <td className="py-1 pr-2 text-right">
                  <Amount value={p.expense_cents} />
                </td>
                <td className="py-1 pr-2 text-right">
                  <Amount value={p.result_cents} tone="signed" />
                </td>
                <td className="py-1 text-right tabular-nums">{p.savings_rate === null ? '—' : formatPercent(p.savings_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.series.some((p) => p.partial) && <p className="mt-2 text-xs text-ink/60">* Mês em andamento: fica fora das médias.</p>}
    </section>
  );
}

function Categories({ analysis: a, partial }: { analysis: Analysis; partial: boolean }) {
  const items = a.categories.filter((c) => c.current_cents > 0 || c.baseline_cents > 0).slice(0, 8);
  const max = Math.max(...items.flatMap((c) => [c.current_cents, c.baseline_cents]), 1);
  return (
    <section aria-labelledby="titulo-categorias" className="rounded-xl bg-white p-4 shadow-sm">
      <h2 id="titulo-categorias" className="font-semibold">
        Categorias: {formatMonth(a.reference)} × média
      </h2>
      <p className="mb-3 text-xs text-ink/60">
        Média dos até 3 meses fechados anteriores{partial ? '; o mês escolhido ainda está em andamento' : ''}. Barra cheia = mês; traço = média.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-ink/70">Sem despesas no período.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.key}>
              <div className="flex justify-between gap-2 text-sm">
                <span>{c.name}</span>
                <span className="text-right">
                  <Amount value={c.current_cents} />
                  <span className="block text-xs text-ink/60">
                    média <Amount value={c.baseline_cents} />
                    {c.change !== null && ` · ${c.change >= 0 ? '+' : ''}${formatPercent(c.change)}`}
                  </span>
                </span>
              </div>
              <div className="relative mt-1 h-2 rounded bg-surface" aria-hidden="true">
                <div className="h-2 rounded bg-brand-500" style={{ width: `${(c.current_cents / max) * 100}%` }} />
                {c.baseline_cents > 0 && (
                  <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${(c.baseline_cents / max) * 100}%` }} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Future({ analysis: a }: { analysis: Analysis }) {
  const max = Math.max(...a.future.map((f) => f.remaining_cents), 1);
  const total = a.future.reduce((s, f) => s + f.remaining_cents, 0);
  return (
    <section aria-labelledby="titulo-futuro" className="rounded-xl bg-white p-4 shadow-sm">
      <h2 id="titulo-futuro" className="font-semibold">
        Faturas já comprometidas
      </h2>
      <p className="mb-3 text-xs text-ink/60">
        Quanto falta pagar nas faturas que vencem em cada mês, com as compras e parcelas já lançadas. Dívida total nos cartões:{' '}
        <Amount value={a.card_debt_cents} />.
      </p>
      {total === 0 ? (
        <p className="text-sm text-ink/70">Nenhuma fatura a pagar nos próximos 6 meses.</p>
      ) : (
        <ul className="space-y-2">
          {a.future.map((f) => (
            <li key={f.month}>
              <div className="flex justify-between gap-2 text-sm">
                <span>{monthTitle(f.month)}</span>
                <Amount value={f.remaining_cents} />
              </div>
              <div className="mt-1 h-2 rounded bg-surface" aria-hidden="true">
                <div className="h-2 rounded bg-warning" style={{ width: `${(f.remaining_cents / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
