import { useCallback, useEffect, useState } from 'react';
import { useServices } from '@/app/services';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StatusViews';
import type { MonthlySummary } from '@/features/finance/types';
import { addMonths } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { savingsRate } from './analysis';
import { monthTitle, shortMonth } from './format';
import { Card, Delta, Tile } from './ui';
import { yearToDate, yearToDateMonths, type CategoryFilter, type Ytd } from './ytd';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; current: MonthlySummary[]; previous: MonthlySummary[] };

const percent = (f: number | null) => (f === null ? '—' : `${Math.round(f * 100)}%`);

export function YearToDate({ householdId, month, today, filter }: { householdId: string; month: string; today: string; filter: CategoryFilter }) {
  const { finance } = useServices();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async (): Promise<State> => {
    try {
      const months = yearToDateMonths(month);
      const [current, previous] = await Promise.all([
        Promise.all(months.map((m) => finance.monthlySummary(householdId, m))),
        Promise.all(months.map((m) => finance.monthlySummary(householdId, addMonths(m, -12)))),
      ]);
      return { status: 'ready', current, previous };
    } catch (err) {
      return { status: 'error', message: toUserMessage(err, 'carregar o acumulado do ano') };
    }
  }, [finance, householdId, month]);

  useEffect(() => {
    let alive = true;
    void load().then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [load]);

  if (state.status === 'loading') return <LoadingState label="Somando o ano…" />;
  if (state.status === 'error')
    return (
      <ErrorState
        message={state.message}
        action={
          <Button variant="secondary" onClick={() => void load().then(setState)}>
            Tentar de novo
          </Button>
        }
      />
    );
  return <Report ytd={yearToDate(state.current, state.previous, today, filter)} month={month} today={today} filtered={filter !== null} />;
}

function Report({ ytd: y, month, today, filtered }: { ytd: Ytd; month: string; today: string; filtered: boolean }) {
  const lastYear = String(Number(y.year) - 1);
  const period = `jan–${shortMonth(month).slice(0, 3)}`;
  const max = Math.max(...y.rows.flatMap((r) => [r.cumulative_expense_cents, r.last_year_cumulative_expense_cents]), 1);
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">
        Ano até agora: {period} de {y.year}
        <span className="block text-sm font-normal text-ink/70">Comparado com {period} de {lastYear}.</span>
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Receitas no ano" hint={<>vs {lastYear}: <Delta current={y.income_cents} previous={y.last_year.income_cents} goodWhenDown={false} /></>}>
          <Amount value={y.income_cents} />
        </Tile>
        <Tile label={filtered ? 'Despesas filtradas no ano' : 'Despesas no ano'} hint={<>vs {lastYear}: <Delta current={y.expense_cents} previous={y.last_year.expense_cents} /></>}>
          <Amount value={y.expense_cents} />
        </Tile>
        <Tile label="Resultado no ano" hint={<>{lastYear}: <Amount value={y.last_year.result_cents} tone="signed" /> · sem filtro</>}>
          <Amount value={y.result_cents} tone="signed" />
        </Tile>
        <Tile label="Taxa de poupança no ano" hint={<>{lastYear}: {percent(savingsRate(y.last_year.income_cents, y.last_year.result_cents))} · referência 20%</>}>
          {percent(savingsRate(y.income_cents, y.result_cents))}
        </Tile>
      </div>

      {y.avg_expense_cents !== null && (
        <p className="rounded-xl bg-white p-4 text-sm shadow-sm">
          Média mensal de {filtered ? 'despesa filtrada' : 'despesa'} nos meses fechados: <strong><Amount value={y.avg_expense_cents} /></strong>. Nesse ritmo, o ano
          fecha com cerca de <strong><Amount value={y.projected_year_expense_cents!} /></strong> em {filtered ? 'despesas dessas categorias' : 'despesas'}
          {y.projected_year_result_cents !== null && (
            <>
              {' '}e um resultado de <Amount value={y.projected_year_result_cents} tone="signed" />
            </>
          )}
          .
        </p>
      )}

      <Card
        id="titulo-ytd-acumulado"
        title={filtered ? 'Despesa filtrada acumulada no ano' : 'Despesa acumulada no ano'}
        subtitle={`Soma mês a mês desde janeiro: ${y.year} (barra) e ${lastYear} (traço).`}
      >
        <ul className="space-y-2">
          {y.rows.map((r) => (
            <li key={r.month}>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span>
                  {monthTitle(r.month)}
                  {r.month >= today && <span className="text-ink/60"> (em andamento)</span>}
                </span>
                <span className="text-right">
                  <Amount value={r.cumulative_expense_cents} />
                  <span className="block text-xs text-ink/60">
                    {lastYear}: <Amount value={r.last_year_cumulative_expense_cents} /> · no mês <Amount value={r.expense_cents} />
                  </span>
                </span>
              </div>
              <div className="relative mt-1 h-2 rounded bg-surface" aria-hidden="true">
                <div className="h-2 rounded bg-chart-expense" style={{ width: `${(r.cumulative_expense_cents / max) * 100}%` }} />
                {r.last_year_cumulative_expense_cents > 0 && (
                  <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${(r.last_year_cumulative_expense_cents / max) * 100}%` }} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="titulo-ytd-categorias" title="Categorias no ano" subtitle={`Total desde janeiro, fatia do total e variação contra ${period} de ${lastYear}.`}>
        {y.categories.length === 0 ? (
          <p className="text-sm text-ink/70">Sem despesas no período{filtered ? ' para as categorias escolhidas' : ''}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/70">
                  <th scope="col" className="py-1 pr-2 font-medium">Categoria</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">{y.year}</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Do total</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Média/mês</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">{lastYear}</th>
                  <th scope="col" className="py-1 text-right font-medium">Variação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {y.categories.map((c) => (
                  <tr key={c.key}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {c.name}
                      <span aria-hidden="true" className="mt-1 block h-1.5 rounded bg-surface">
                        <span className="block h-1.5 rounded bg-brand-900" style={{ width: `${Math.round(c.share * 100)}%` }} />
                      </span>
                    </th>
                    <td className="py-1 pr-2 text-right">
                      <Amount value={c.total_cents} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{percent(c.share)}</td>
                    <td className="py-1 pr-2 text-right">
                      <Amount value={Math.round(c.total_cents / Math.max(y.months, 1))} />
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <Amount value={c.last_year_cents} />
                    </td>
                    <td className="py-1 text-right">
                      <Delta current={c.total_cents} previous={c.last_year_cents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
