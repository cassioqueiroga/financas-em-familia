import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useServices } from '@/app/services';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '@/components/ui/StatusViews';
import { currentMonth, formatBusinessDate, formatMonth, toBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { useFinance } from './FinanceContext';
import { MonthPicker, PageHeader, SpaceGate } from './shared';
import { ACCOUNT_KIND_LABEL, STATEMENT_STATUS_LABEL, type MonthlySummary } from './types';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; summary: MonthlySummary };

function Tile({ label, value, hint, tone = 'neutral' }: { label: string; value: number; hint?: string; tone?: 'neutral' | 'signed' }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-sm text-ink/70">{label}</p>
      <p className="mt-1 text-xl font-bold">
        <Amount value={value} tone={tone} />
      </p>
      {hint && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
    </div>
  );
}

function Breakdown({ title, items }: { title: string; items: { key: string; label: string; total: number }[] }) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <section aria-label={title} className="rounded-xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink/70">Sem despesas neste mês.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key}>
              <div className="flex justify-between gap-2 text-sm">
                <span>{i.label}</span>
                <Amount value={i.total} />
              </div>
              <div className="mt-1 h-2 rounded bg-surface" aria-hidden="true">
                <div className="h-2 rounded bg-brand-500" style={{ width: `${Math.round((i.total / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardPage() {
  return (
    <section aria-labelledby="titulo-inicio" className="space-y-6">
      <PageHeader id="titulo-inicio" title="Início" description="Resumo financeiro do mês, calculado a partir dos lançamentos registrados." />
      <SpaceGate>
        <Summary />
      </SpaceGate>
    </section>
  );
}

function Summary() {
  const { finance } = useServices();
  const { active, data, memberName, reload } = useFinance();
  const [month, setMonth] = useState(() => currentMonth(active?.timezone));
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const householdId = active?.id;

  const fetchSummary = useCallback(
    (): Promise<State> =>
      householdId
        ? finance.monthlySummary(householdId, month).then(
            (summary): State => ({ status: 'ready', summary }),
            (err: unknown): State => ({ status: 'error', message: toUserMessage(err, 'carregar resumo') }),
          )
        : Promise.resolve({ status: 'loading' }),
    [finance, householdId, month],
  );

  useEffect(() => {
    let alive = true;
    void fetchSummary().then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [fetchSummary, data]);

  if (data.accounts.length === 0) {
    return (
      <EmptyState
        title="Cadastre sua primeira conta"
        description="Com uma conta (corrente, poupança, carteira ou cartão) você já pode registrar receitas e despesas."
        action={
          <Link to="/contas" className="rounded-lg bg-brand-900 px-4 py-2 text-sm font-semibold text-white">
            Cadastrar conta
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">
          Período: <span className="capitalize">{formatMonth(month)}</span>
        </p>
        <MonthPicker month={month} onChange={setMonth} />
      </div>
      {notice && <SuccessState message={notice} />}
      {state.status === 'loading' && <LoadingState label="Calculando resumo…" />}
      {state.status === 'error' && (
        <ErrorState
          message={state.message}
          action={
            <Button variant="secondary" onClick={() => void fetchSummary().then(setState)}>
              Tentar de novo
            </Button>
          }
        />
      )}
      {state.status === 'ready' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Tile label="Saldo disponível hoje" value={state.summary.available_cents} tone="signed" hint="Soma das contas ativas (sem cartões)." />
            <Tile label="Receitas do mês" value={state.summary.income_cents} />
            <Tile label="Despesas do mês" value={state.summary.expense_cents} hint="Inclui compras no cartão pela fatura do mês." />
            <Tile label="Resultado do mês" value={state.summary.result_cents} tone="signed" hint="Receitas menos despesas do período." />
            <Tile
              label="Compromissos do mês"
              value={state.summary.pending_expense_cents + state.summary.statements_due_cents}
              hint="Contas a pagar pendentes + faturas que vencem no mês."
            />
            <Tile label="Dívida total nos cartões" value={state.summary.card_debt_cents} hint="Todas as faturas e parcelas futuras." />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown
              title="Despesas por categoria"
              items={state.summary.expenses_by_category.map((c) => ({ key: c.category_id ?? 'sem', label: c.name ?? 'Sem categoria', total: c.total_cents }))}
            />
            <Breakdown
              title="Despesas por pessoa"
              items={state.summary.expenses_by_member.map((m) => ({ key: m.user_id ?? 'sem', label: memberName(m.user_id), total: m.total_cents }))}
            />
          </div>

          <section aria-label="Saldo por conta" className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">Saldo por conta</h2>
            <ul className="divide-y divide-ink/10">
              {state.summary.balances.map((b) => (
                <li key={b.account_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span>
                    {b.name} <span className="text-ink/60">· {ACCOUNT_KIND_LABEL[b.kind]}{b.is_active ? '' : ' · desativada'}</span>
                  </span>
                  <span className="text-right">
                    <Amount value={b.balance_cents} tone="signed" />
                    {b.available_credit_cents !== null && (
                      <span className="block text-xs text-ink/60">
                        Limite disponível: <Amount value={b.available_credit_cents} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Contas a pagar e a receber" className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">Contas a pagar e a receber no mês</h2>
            {state.summary.pending.length === 0 ? (
              <p className="text-sm text-ink/70">Nenhum lançamento pendente neste mês.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {state.summary.pending.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      {formatBusinessDate(p.occurred_on)} · {p.description}{' '}
                      <span className="text-ink/60">({p.kind === 'income' ? 'a receber' : 'a pagar'})</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Amount value={p.amount_cents} />
                      <ConfirmButton
                        label={p.kind === 'income' ? 'Marcar como recebido' : 'Marcar como pago'}
                        question="Efetivar hoje?"
                        onConfirm={async () => {
                          try {
                            await finance.settleEntry(p.id, p.version, toBusinessDate(new Date(), active?.timezone));
                            setNotice(`“${p.description}” efetivado.`);
                            await reload();
                          } catch (err) {
                            setNotice(null);
                            setState({ status: 'error', message: toUserMessage(err, 'efetivar lançamento') });
                          }
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Faturas do mês" className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">Faturas que vencem no mês</h2>
            {state.summary.statements_due.length === 0 ? (
              <p className="text-sm text-ink/70">Nenhuma fatura vence neste mês.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {state.summary.statements_due.map((s) => (
                  <li key={`${s.card_account_id}-${s.statement_month}`} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span>
                      {s.card_name} · vence {formatBusinessDate(s.due_date)} · {STATEMENT_STATUS_LABEL[s.status]}
                    </span>
                    <span>
                      Falta pagar <Amount value={s.remaining_cents} /> de <Amount value={s.total_cents} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
