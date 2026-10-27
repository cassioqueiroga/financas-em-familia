import { useCallback, useEffect, useState } from 'react';
import { useServices } from '@/app/services';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StatusViews';
import { useFinance } from '@/features/finance/FinanceContext';
import type { Entry, MonthlySummary } from '@/features/finance/types';
import { addMonths, formatBusinessDate, monthBounds, toBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { savingsRate } from './analysis';
import {
  GROUP_LABEL,
  byWeekday,
  categoryName,
  categoryGroups,
  categoryRows,
  cumulativeByDay,
  detailRange,
  monthExpenses,
  monthIncomes,
  projectMonth,
  splitByGroup,
  topExpenses,
} from './deep';
import { formatBRL, monthTitle } from './format';
import { filterEntries, filterSummary, type CategoryFilter } from './ytd';
import { Card, CumulativeChart, Delta, STRIPES, StackedBar, Tile } from './ui';

interface Loaded {
  current: MonthlySummary;
  previous: MonthlySummary;
  lastYear: MonthlySummary;
  entries: Entry[];
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Loaded };

const percent = (f: number | null) => (f === null ? '—' : `${Math.round(f * 100)}%`);

export function MonthDetail({
  householdId,
  month,
  today,
  timezone,
  filter,
}: {
  householdId: string;
  month: string;
  today: string;
  timezone: string | undefined;
  filter: CategoryFilter;
}) {
  const { finance } = useServices();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async (): Promise<State> => {
    try {
      const range = detailRange(month);
      const [current, previous, lastYear, entries] = await Promise.all([
        finance.monthlySummary(householdId, month),
        finance.monthlySummary(householdId, addMonths(month, -1)),
        finance.monthlySummary(householdId, addMonths(month, -12)),
        finance.listEntries(householdId, range.from, range.to),
      ]);
      return { status: 'ready', data: { current, previous, lastYear, entries } };
    } catch (err) {
      return { status: 'error', message: toUserMessage(err, 'carregar o detalhe do mês') };
    }
  }, [finance, householdId, month]);

  useEffect(() => {
    let alive = true;
    void load().then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [load]);

  if (state.status === 'loading') return <LoadingState label="Detalhando o mês…" />;
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
  const todayDay = month === today ? Number(toBusinessDate(new Date(), timezone).slice(8, 10)) : null;
  const d = state.data;
  const view = filter
    ? { current: filterSummary(d.current, filter), previous: filterSummary(d.previous, filter), lastYear: filterSummary(d.lastYear, filter), entries: filterEntries(d.entries, filter) }
    : d;
  return <Detail data={view} month={month} todayDay={todayDay} filtered={filter !== null} />;
}

function Detail({ data, month, todayDay, filtered }: { data: Loaded; month: string; todayDay: number | null; filtered: boolean }) {
  const { data: space, memberName } = useFinance();
  const { current: c, previous: p, lastYear: y, entries } = data;
  const prevMonth = addMonths(month, -1);
  const rate = savingsRate(c.income_cents, c.result_cents);

  const curve = cumulativeByDay(entries, month);
  const prevCurve = cumulativeByDay(entries, prevMonth);
  const shownCurve = todayDay ? curve.slice(0, todayDay) : curve;
  const { from: mFrom, to: mTo } = monthBounds(month);
  const pendingExpense = filtered
    ? entries.filter((e) => e.status === 'pending' && e.kind === 'expense' && e.occurred_on >= mFrom && e.occurred_on <= mTo).reduce((s, e) => s + e.amount_cents, 0)
    : c.pending_expense_cents;
  const projection = todayDay ? projectMonth(curve, todayDay, pendingExpense) : null;
  const byMember = filtered
    ? Object.entries(
        monthExpenses(entries, month).reduce<Record<string, number>>((acc, e) => {
          const k = e.attributed_to ?? '';
          acc[k] = (acc[k] ?? 0) + e.amount_cents;
          return acc;
        }, {}),
      )
        .map(([user_id, total_cents]) => ({ user_id: user_id || null, total_cents }))
        .sort((a, b) => b.total_cents - a.total_cents)
    : c.expenses_by_member;
  const prevAtSameDay = todayDay ? (prevCurve[Math.min(todayDay, prevCurve.length) - 1] ?? 0) : null;

  const groups = categoryGroups(space.categories);
  const split = splitByGroup(c, groups);
  const rows = categoryRows(c, p, groups);
  const top = topExpenses(entries, month);
  const weekdays = byWeekday(entries, month);
  const weekMax = Math.max(...weekdays.map((w) => w.total_cents), 1);
  const incomes = Object.entries(
    monthIncomes(entries, month).reduce<Record<string, number>>((acc, e) => {
      const key = categoryName(space.categories, e.category_id);
      acc[key] = (acc[key] ?? 0) + e.amount_cents;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{monthTitle(month)}</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Receitas"
          hint={
            <>
              vs {monthTitle(prevMonth).toLowerCase()}: <Delta current={c.income_cents} previous={p.income_cents} goodWhenDown={false} /> · vs um ano antes:{' '}
              <Delta current={c.income_cents} previous={y.income_cents} goodWhenDown={false} />
            </>
          }
        >
          <Amount value={c.income_cents} />
        </Tile>
        <Tile
          label={filtered ? 'Despesas filtradas' : 'Despesas'}
          hint={
            <>
              vs mês anterior: <Delta current={c.expense_cents} previous={p.expense_cents} /> · vs um ano antes:{' '}
              <Delta current={c.expense_cents} previous={y.expense_cents} />
            </>
          }
        >
          <Amount value={c.expense_cents} />
        </Tile>
        <Tile label="Resultado" hint={<>Mês anterior: {formatBRL(p.result_cents)}</>}>
          <Amount value={c.result_cents} tone="signed" />
        </Tile>
        <Tile label="Taxa de poupança" hint={<>Mês anterior: {percent(savingsRate(p.income_cents, p.result_cents))} · referência 20%</>}>
          {percent(rate)}
        </Tile>
      </div>

      <Card
        id="titulo-ritmo"
        title="Ritmo de gastos no mês"
        subtitle="Despesa acumulada dia a dia, comparada com o mês anterior. Parcelas de cartão lançadas antes do mês contam no dia 1."
      >
        <CumulativeChart
          label={`Gasto acumulado de ${monthTitle(month)} comparado com ${monthTitle(prevMonth)}`}
          series={[
            { key: 'prev', label: 'Mês anterior', values: prevCurve, dashed: true, className: 'stroke-ink/40' },
            { key: 'cur', label: 'Este mês', values: shownCurve, className: 'stroke-chart-income' },
          ]}
        />
        {projection && prevAtSameDay !== null ? (
          <ul className="mt-3 space-y-1 text-sm">
            <li>
              Até o dia {projection.elapsed_days}: <Amount value={projection.spent_cents} /> gastos, contra <Amount value={prevAtSameDay} /> no mesmo ponto do mês
              anterior (<Delta current={projection.spent_cents} previous={prevAtSameDay} />
              ).
            </li>
            <li>
              No ritmo atual, somando <Amount value={projection.pending_cents} /> de contas a pagar já agendadas, o mês deve fechar perto de{' '}
              <strong>
                <Amount value={projection.projected_cents} />
              </strong>{' '}
              em despesas{c.income_cents > 0 && <> ({percent(projection.projected_cents / c.income_cents)} da receita já recebida)</>}.
            </li>
            <li className="text-xs text-ink/60">Estimativa simples pelo ritmo diário; gastos grandes no início do mês fazem a projeção subir.</li>
          </ul>
        ) : (
          <p className="mt-3 text-sm">
            Fechou com <Amount value={c.expense_cents} /> em despesas, contra <Amount value={p.expense_cents} /> no mês anterior (
            <Delta current={c.expense_cents} previous={p.expense_cents} />
            ).
          </p>
        )}
      </Card>

      <Card id="titulo-destino" title="Para onde foi o dinheiro" subtitle="Despesas do mês por grupo, sobre a receita do mês (regra 50-30-20).">
        {c.income_cents <= 0 && c.expense_cents <= 0 ? (
          <p className="text-sm text-ink/70">Sem lançamentos neste mês.</p>
        ) : (
          <>
            <StackedBar
              label="Divisão do mês entre necessidades, estilo de vida, sem grupo e sobra"
              total={Math.max(c.income_cents, c.expense_cents)}
              segments={[
                { key: 'e', label: GROUP_LABEL.essential, value: split.essential_cents, className: 'bg-chart-essential' },
                { key: 'l', label: GROUP_LABEL.lifestyle, value: split.lifestyle_cents, className: 'bg-chart-expense' },
                { key: 'u', label: GROUP_LABEL.unclassified, value: split.unclassified_cents, className: STRIPES },
                { key: 's', label: 'Sobra', value: Math.max(split.savings_cents, 0), className: 'bg-chart-income' },
              ]}
            />
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {[
                { k: 'e', label: GROUP_LABEL.essential, v: split.essential_cents, ref: 'até 50%', sw: 'bg-chart-essential' },
                { k: 'l', label: GROUP_LABEL.lifestyle, v: split.lifestyle_cents, ref: 'até 30%', sw: 'bg-chart-expense' },
                { k: 'u', label: GROUP_LABEL.unclassified, v: split.unclassified_cents, ref: '', sw: STRIPES },
                { k: 's', label: 'Sobra', v: split.savings_cents, ref: 'ao menos 20%', sw: 'bg-chart-income' },
              ].map((g) => (
                <li key={g.k} className="flex items-center justify-between gap-2">
                  <span>
                    <span aria-hidden="true" className={`mr-2 inline-block size-3 rounded-sm align-middle ${g.sw}`} />
                    {g.label} <span className="text-ink/60">{g.ref && `(${g.ref})`}</span>
                  </span>
                  <span className="text-right">
                    <Amount value={g.v} tone={g.k === 's' ? 'signed' : 'neutral'} />{' '}
                    <span className="text-ink/60 tabular-nums">{c.income_cents > 0 ? `· ${percent(g.v / c.income_cents)}` : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card id="titulo-cat-mes" title="Despesas por categoria" subtitle={`Participação no total do mês e variação contra ${monthTitle(prevMonth).toLowerCase()}.`}>
        {rows.length === 0 ? (
          <p className="text-sm text-ink/70">Sem despesas neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/70">
                  <th scope="col" className="py-1 pr-2 font-medium">Categoria</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Grupo</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Valor</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Do total</th>
                  <th scope="col" className="py-1 text-right font-medium">vs anterior</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {r.name}
                      <span aria-hidden="true" className="mt-1 block h-1.5 rounded bg-surface">
                        <span className="block h-1.5 rounded bg-brand-900" style={{ width: `${Math.round(r.share * 100)}%` }} />
                      </span>
                    </th>
                    <td className="py-1 pr-2 text-ink/70">{GROUP_LABEL[r.group]}</td>
                    <td className="py-1 pr-2 text-right">
                      <Amount value={r.current_cents} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{percent(r.share)}</td>
                    <td className="py-1 text-right">
                      <Delta current={r.current_cents} previous={r.previous_cents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="titulo-maiores" title="Maiores despesas do mês" subtitle="Os 10 lançamentos de maior valor, incluindo parcelas de cartão desta fatura.">
          {top.length === 0 ? (
            <p className="text-sm text-ink/70">Sem despesas neste mês.</p>
          ) : (
            <ol className="divide-y divide-ink/10 text-sm">
              {top.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {e.description}
                    <span className="block text-xs text-ink/60">
                      {formatBusinessDate(e.occurred_on)} · {categoryName(space.categories, e.category_id)}
                      {e.installment_count && e.installment_count > 1 ? ` · parcela ${e.installment_number}/${e.installment_count}` : ''}
                    </span>
                  </span>
                  <Amount value={e.amount_cents} />
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-4">
          <Card id="titulo-receitas-mes" title="Receitas por categoria">
            {incomes.length === 0 ? (
              <p className="text-sm text-ink/70">Nenhuma receita efetivada neste mês.</p>
            ) : (
              <ul className="divide-y divide-ink/10 text-sm">
                {incomes.map(([name, total]) => (
                  <li key={name} className="flex justify-between gap-2 py-1.5">
                    <span>{name}</span>
                    <span>
                      <Amount value={total} /> <span className="text-ink/60">· {percent(total / Math.max(c.income_cents, 1))}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card id="titulo-pessoas-mes" title="Despesas por pessoa">
            {byMember.length === 0 ? (
              <p className="text-sm text-ink/70">Sem despesas neste mês.</p>
            ) : (
              <ul className="divide-y divide-ink/10 text-sm">
                {byMember.map((m) => (
                  <li key={m.user_id ?? 'sem'} className="flex justify-between gap-2 py-1.5">
                    <span>{memberName(m.user_id)}</span>
                    <span>
                      <Amount value={m.total_cents} /> <span className="text-ink/60">· {percent(m.total_cents / Math.max(c.expense_cents, 1))}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card id="titulo-semana" title="Gastos por dia da semana" subtitle="Só despesas com data neste mês (parcelas lançadas antes ficam de fora).">
        <ul className="grid grid-cols-7 items-end gap-2 text-center text-xs">
          {weekdays.map((w) => (
            <li key={w.label} className="flex flex-col items-center gap-1">
              <span className="tabular-nums text-ink/70">{w.total_cents > 0 ? formatBRL(w.total_cents).replace(/,\d\d$/, '') : '—'}</span>
              <span aria-hidden="true" className="flex h-24 w-full items-end justify-center">
                <span className="w-4 rounded-t bg-chart-expense" style={{ height: `${(w.total_cents / weekMax) * 100}%` }} />
              </span>
              <span>{w.label}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
