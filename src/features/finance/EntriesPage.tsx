import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useServices } from '@/app/services';
import { Field, MoneyInput, Select, TextInput } from '@/components/form/Field';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '@/components/ui/StatusViews';
import { currentMonth, formatBusinessDate, formatMonth, monthBounds, toBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { centsToDecimalString, cents } from '@/lib/money';
import { useFinance } from './FinanceContext';
import { AccountOptions, MonthPicker, PageHeader, SpaceGate, parsePositiveAmount, useIdempotencyKey, useWritableAccounts } from './shared';
import { ENTRY_KIND_LABEL, type Entry } from './types';

type ListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: Entry[] };
type Mode = 'expense' | 'income' | 'transfer';

const OUTFLOW = new Set(['expense', 'transfer_out', 'card_charge', 'card_payment_out']);

export function EntriesPage() {
  return (
    <section aria-labelledby="titulo-lancamentos" className="space-y-6">
      <PageHeader id="titulo-lancamentos" title="Lançamentos" description="Receitas, despesas e transferências. Nada é apagado: correções ficam no histórico." />
      <SpaceGate>
        <Entries />
      </SpaceGate>
    </section>
  );
}

function Entries() {
  const { finance } = useServices();
  const { active, data, reload } = useFinance();
  const [month, setMonth] = useState(() => currentMonth(active?.timezone));
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [accountFilter, setAccountFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const householdId = active?.id;

  const fetchList = useCallback((): Promise<ListState> => {
    if (!householdId) return Promise.resolve({ status: 'loading' });
    const { from, to } = monthBounds(month);
    return finance.listEntries(householdId, from, to).then(
      (items): ListState => ({ status: 'ready', items }),
      (err: unknown): ListState => ({ status: 'error', message: toUserMessage(err, 'listar lançamentos') }),
    );
  }, [finance, householdId, month]);

  useEffect(() => {
    let alive = true;
    void fetchList().then((next) => alive && setList(next));
    return () => {
      alive = false;
    };
  }, [fetchList, data]);

  const accountName = useCallback((id: string) => data.accounts.find((a) => a.id === id)?.name ?? 'Conta sem acesso', [data.accounts]);
  const categoryName = useCallback((id: string | null) => (id ? (data.categories.find((c) => c.id === id)?.name ?? '—') : 'Sem categoria'), [data.categories]);

  const filtered = useMemo(() => {
    if (list.status !== 'ready') return [];
    return list.items.filter(
      (e) =>
        (showCancelled || e.status !== 'cancelled') &&
        (!accountFilter || e.account_id === accountFilter) &&
        (!kindFilter || (kindFilter === 'transfer' ? e.kind.startsWith('transfer') : kindFilter === 'card' ? e.kind.startsWith('card') : e.kind === kindFilter)),
    );
  }, [list, showCancelled, accountFilter, kindFilter]);

  const done = async (message: string) => {
    setNotice(message);
    setActionError(null);
    setEditing(null);
    await reload();
  };

  return (
    <div className="space-y-6">
      <NewEntryForm onDone={done} />

      <section aria-labelledby="titulo-lista" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titulo-lista" className="text-lg font-semibold">
            Lançamentos de <span className="capitalize">{formatMonth(month)}</span>
          </h2>
          <MonthPicker month={month} onChange={setMonth} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="filtro-conta" label="Conta">
            <Select id="filtro-conta" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="w-auto">
              <AccountOptions accounts={data.accounts} placeholder="Todas" />
            </Select>
          </Field>
          <Field id="filtro-tipo" label="Tipo">
            <Select id="filtro-tipo" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="w-auto">
              <option value="">Todos</option>
              <option value="income">Receitas</option>
              <option value="expense">Despesas</option>
              <option value="transfer">Transferências</option>
              <option value="card">Cartão</option>
            </Select>
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Mostrar cancelados
          </label>
        </div>
        {notice && <SuccessState message={notice} />}
        {actionError && <ErrorState message={actionError} />}
        {list.status === 'loading' && <LoadingState label="Carregando lançamentos…" />}
        {list.status === 'error' && (
          <ErrorState
            message={list.message}
            action={
              <Button variant="secondary" onClick={() => void fetchList().then(setList)}>
                Tentar de novo
              </Button>
            }
          />
        )}
        {list.status === 'ready' && filtered.length === 0 && (
          <EmptyState title="Nenhum lançamento neste período" description="Registre receitas, despesas ou transferências no formulário acima." />
        )}
        {filtered.length > 0 && (
          <ul className="divide-y divide-ink/10 rounded-xl bg-white shadow-sm">
            {filtered.map((e) => (
              <li key={e.id} className={`space-y-2 p-4 ${e.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className={`font-medium ${e.status === 'cancelled' ? 'line-through' : ''}`}>
                      {e.description}
                      {e.installment_count && e.installment_count > 1 ? ` (${e.installment_number}/${e.installment_count})` : ''}
                    </p>
                    <p className="text-xs text-ink/70">
                      {formatBusinessDate(e.occurred_on)} · {ENTRY_KIND_LABEL[e.kind]} · {accountName(e.account_id)}
                      {(e.kind === 'income' || e.kind === 'expense' || e.kind === 'card_charge') && ` · ${categoryName(e.category_id)}`}
                      {e.status === 'pending' && ' · pendente'}
                      {e.status === 'cancelled' && ' · cancelado'}
                    </p>
                  </div>
                  <p className="font-semibold">
                    {OUTFLOW.has(e.kind) ? '− ' : '+ '}
                    <Amount value={e.amount_cents} />
                  </p>
                </div>
                {e.status !== 'cancelled' && e.kind !== 'card_charge' && e.kind !== 'card_payment_in' && (
                  <div className="flex flex-wrap gap-2">
                    {(e.kind === 'income' || e.kind === 'expense') && (
                      <Button variant="secondary" className="text-sm" aria-expanded={editing === e.id} onClick={() => setEditing(editing === e.id ? null : e.id)}>
                        {editing === e.id ? 'Fechar edição' : 'Corrigir'}
                      </Button>
                    )}
                    {e.status === 'pending' && (
                      <ConfirmButton
                        label={e.kind === 'income' ? 'Marcar como recebido' : 'Marcar como pago'}
                        question="Efetivar hoje?"
                        onConfirm={async () => {
                          try {
                            await finance.settleEntry(e.id, e.version, toBusinessDate(new Date(), active?.timezone));
                            await done(`“${e.description}” efetivado.`);
                          } catch (err) {
                            setActionError(toUserMessage(err, 'efetivar lançamento'));
                          }
                        }}
                      />
                    )}
                    <ConfirmButton
                      label="Cancelar lançamento"
                      question={e.transfer_id ? 'Cancelar as duas pontas desta operação?' : 'Cancelar este lançamento? Ele fica no histórico como cancelado.'}
                      confirmLabel="Sim, cancelar"
                      onConfirm={async () => {
                        try {
                          await finance.cancelEntry(e.id, e.version);
                          await done(`“${e.description}” cancelado.`);
                        } catch (err) {
                          setActionError(toUserMessage(err, 'cancelar lançamento'));
                        }
                      }}
                    />
                  </div>
                )}
                {e.kind === 'card_charge' && e.status !== 'cancelled' && <p className="text-xs text-ink/70">Para estornar, cancele a compra na tela de cartões.</p>}
                {editing === e.id && <EditEntryForm entry={e} onDone={done} onError={setActionError} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CategoryAndMember({ kind, categoryId, attributedTo, prefix }: { kind: 'income' | 'expense'; categoryId?: string | null; attributedTo?: string | null; prefix: string }) {
  const { data, memberName } = useFinance();
  const categories = data.categories.filter((c) => c.kind === kind && (c.is_active || c.id === categoryId));
  return (
    <>
      <Field id={`${prefix}-categoria`} label="Categoria">
        <Select id={`${prefix}-categoria`} name="category_id" defaultValue={categoryId ?? ''}>
          <option value="">Sem categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${prefix}-pessoa`} label={kind === 'income' ? 'Recebido por' : 'Gasto de'}>
        <Select id={`${prefix}-pessoa`} name="attributed_to" defaultValue={attributedTo ?? ''}>
          <option value="">Não atribuído</option>
          {data.members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {memberName(m.user_id)}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function NewEntryForm({ onDone }: { onDone(message: string): Promise<void> }) {
  const { finance } = useServices();
  const { active } = useFinance();
  const { accounts, me } = useWritableAccounts();
  const [mode, setMode] = useState<Mode>('expense');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const key = useIdempotencyKey();
  const bankAccounts = accounts.filter((a) => a.kind !== 'credit_card');
  const today = toBusinessDate(new Date(), active?.timezone);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const amount = parsePositiveAmount(form.get('amount'));
    if ('error' in amount) return setError(amount.error);
    const occurredOn = String(form.get('occurred_on') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return setError('Informe a data.');
    const description = String(form.get('description') ?? '').trim();
    if (!description || description.length > 120) return setError('Informe uma descrição de até 120 caracteres.');
    const accountId = String(form.get('account_id') ?? '');
    if (!accountId) return setError(mode === 'transfer' ? 'Escolha a conta de origem.' : 'Escolha a conta.');
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'transfer') {
        const toAccountId = String(form.get('to_account_id') ?? '');
        if (!toAccountId || toAccountId === accountId) {
          setError('Escolha uma conta de destino diferente da origem.');
          return;
        }
        await finance.createTransfer({ fromAccountId: accountId, toAccountId, amountCents: amount.cents, occurredOn, description, idempotencyKey: key.current });
      } else {
        await finance.createEntry({
          accountId,
          kind: mode,
          amountCents: amount.cents,
          occurredOn,
          description,
          categoryId: String(form.get('category_id') ?? '') || null,
          attributedTo: String(form.get('attributed_to') ?? '') || null,
          status: form.get('pending') === 'on' ? 'pending' : 'posted',
          idempotencyKey: key.current,
        });
      }
      key.renew();
      formEl.reset();
      await onDone(mode === 'transfer' ? 'Transferência registrada.' : `${mode === 'income' ? 'Receita' : 'Despesa'} registrada.`);
    } catch (err) {
      setError(toUserMessage(err, 'registrar lançamento'));
    } finally {
      setSubmitting(false);
    }
  }

  if (bankAccounts.length === 0) {
    return (
      <EmptyState
        title="Nenhuma conta disponível para lançar"
        description="Cadastre uma conta corrente, poupança ou carteira (ou peça para o titular compartilhar uma com você). Compras no cartão ficam na tela Cartões."
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="titulo-novo-lancamento" className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h2 id="titulo-novo-lancamento" className="text-lg font-semibold">
        Novo lançamento
      </h2>
      <div role="radiogroup" aria-label="Tipo de lançamento" className="flex flex-wrap gap-2">
        {(
          [
            ['expense', 'Despesa'],
            ['income', 'Receita'],
            ['transfer', 'Transferência'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-semibold ${mode === value ? 'border-brand-900 bg-brand-900 text-white' : 'border-ink/30 bg-white'}`}>
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => {
                setMode(value);
                setError(null);
                key.renew();
              }}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="novo-descricao" label="Descrição">
          <TextInput id="novo-descricao" name="description" maxLength={120} />
        </Field>
        <Field id="novo-valor" label="Valor (R$)">
          <MoneyInput id="novo-valor" name="amount" />
        </Field>
        <Field id="novo-data" label={mode === 'expense' ? 'Data (ou vencimento, se pendente)' : 'Data'}>
          <TextInput id="novo-data" name="occurred_on" type="date" defaultValue={today} />
        </Field>
        <Field id="novo-conta" label={mode === 'transfer' ? 'De (origem)' : 'Conta'}>
          <Select id="novo-conta" name="account_id" defaultValue="">
            <AccountOptions accounts={bankAccounts} />
          </Select>
        </Field>
        {mode === 'transfer' ? (
          <Field id="novo-destino" label="Para (destino)">
            <Select id="novo-destino" name="to_account_id" defaultValue="">
              <AccountOptions accounts={bankAccounts} />
            </Select>
          </Field>
        ) : (
          <CategoryAndMember key={mode} kind={mode} prefix="novo" attributedTo={me} />
        )}
      </div>
      {mode !== 'transfer' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pending" /> {mode === 'expense' ? 'Ainda não paguei (conta a pagar)' : 'Ainda não recebi (a receber)'}
        </label>
      )}
      <Button type="submit" loading={submitting}>
        Registrar
      </Button>
    </form>
  );
}

function EditEntryForm({ entry, onDone, onError }: { entry: Entry; onDone(message: string): Promise<void>; onError(message: string): void }) {
  const { finance } = useServices();
  const [saving, setSaving] = useState(false);
  const key = useIdempotencyKey();
  const kind = entry.kind === 'income' ? 'income' : 'expense';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = parsePositiveAmount(form.get('amount'));
    if ('error' in amount) return onError(amount.error);
    const description = String(form.get('description') ?? '').trim();
    if (!description) return onError('Informe a descrição.');
    setSaving(true);
    try {
      await finance.updateEntry({
        entryId: entry.id,
        expectedVersion: entry.version,
        amountCents: amount.cents,
        occurredOn: String(form.get('occurred_on') ?? entry.occurred_on),
        description,
        categoryId: String(form.get('category_id') ?? '') || null,
        attributedTo: String(form.get('attributed_to') ?? '') || null,
        idempotencyKey: key.current,
      });
      key.renew();
      await onDone('Lançamento corrigido. O original ficou no histórico como cancelado.');
    } catch (err) {
      onError(toUserMessage(err, 'corrigir lançamento'));
    } finally {
      setSaving(false);
    }
  }

  const prefix = `edit-${entry.id}`;
  return (
    <form onSubmit={handleSubmit} noValidate aria-label={`Corrigir ${entry.description}`} className="grid gap-3 border-t border-ink/10 pt-3 sm:grid-cols-2">
      <Field id={`${prefix}-descricao`} label="Descrição">
        <TextInput id={`${prefix}-descricao`} name="description" defaultValue={entry.description} maxLength={120} />
      </Field>
      <Field id={`${prefix}-valor`} label="Valor (R$)">
        <MoneyInput id={`${prefix}-valor`} name="amount" defaultValue={centsToDecimalString(cents(entry.amount_cents)).replace('.', ',')} />
      </Field>
      <Field id={`${prefix}-data`} label="Data">
        <TextInput id={`${prefix}-data`} name="occurred_on" type="date" defaultValue={entry.occurred_on} />
      </Field>
      <CategoryAndMember kind={kind} prefix={prefix} categoryId={entry.category_id} attributedTo={entry.attributed_to} />
      <div className="sm:col-span-2">
        <Button type="submit" loading={saving}>
          Salvar correção
        </Button>
      </div>
    </form>
  );
}
