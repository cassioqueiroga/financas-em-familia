import { useState, type FormEvent } from 'react';
import { useServices } from '@/app/services';
import { Field, MoneyInput, Select, TextInput } from '@/components/form/Field';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { EmptyState, ErrorState, SuccessState } from '@/components/ui/StatusViews';
import { toBusinessDate, formatBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { MoneyError, centsToDecimalString, cents, parseBRL } from '@/lib/money';
import { useFinance } from './FinanceContext';
import { PageHeader, SpaceGate, parsePositiveAmount, useIdempotencyKey, useWritableAccounts } from './shared';
import { ACCOUNT_KIND_LABEL, type Account, type AccountKind, type GrantAccess } from './types';

const toInputMoney = (value: number) => centsToDecimalString(cents(value)).replace('.', ',');

function parseSignedAmount(raw: FormDataEntryValue | null): { cents: number } | { error: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { cents: 0 };
  try {
    return { cents: parseBRL(text) };
  } catch (err) {
    if (err instanceof MoneyError) return { error: 'Saldo inválido. Use o formato 1.234,56 (negativo com -).' };
    throw err;
  }
}

function parseDay(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? ''));
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : null;
}

export function AccountsPage() {
  return (
    <section aria-labelledby="titulo-contas" className="space-y-6">
      <PageHeader id="titulo-contas" title="Contas e cartões" description="Saldos calculados a partir do saldo inicial e dos lançamentos." />
      <SpaceGate>
        <Accounts />
      </SpaceGate>
    </section>
  );
}

function Accounts() {
  const { finance } = useServices();
  const { active, data, reload, memberName } = useFinance();
  const { me, myRole } = useWritableAccounts();
  const [kind, setKind] = useState<AccountKind>('checking');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const key = useIdempotencyKey();
  const others = data.members.filter((m) => m.user_id !== me);
  const canCreate = myRole !== undefined && myRole !== 'viewer';

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !active) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setSuccess(null);
    const name = String(form.get('name') ?? '').trim();
    if (!name || name.length > 60) return setError('Informe um nome de até 60 caracteres.');
    let initial = 0;
    let limit: number | null = null;
    let closingDay: number | null = null;
    let dueDay: number | null = null;
    if (kind === 'credit_card') {
      const parsedLimit = parsePositiveAmount(form.get('limit'));
      if ('error' in parsedLimit) return setError(`Limite: ${parsedLimit.error}`);
      limit = parsedLimit.cents;
      closingDay = parseDay(form.get('closing_day'));
      dueDay = parseDay(form.get('due_day'));
      if (!closingDay || !dueDay) return setError('Informe dias de fechamento e vencimento entre 1 e 28.');
    } else {
      const parsed = parseSignedAmount(form.get('initial'));
      if ('error' in parsed) return setError(parsed.error);
      initial = parsed.cents;
    }
    const date = String(form.get('initial_date') || toBusinessDate(new Date(), active.timezone));
    const shareWith = others.filter((m) => form.get(`share-${m.user_id}`) === 'on').map((m) => m.user_id);
    const shareAccess = (form.get('share_access') === 'read' ? 'read' : 'write') as GrantAccess;
    setError(null);
    setSubmitting(true);
    try {
      const created = await finance.createAccount({
        householdId: active.id,
        name,
        kind,
        initialBalanceCents: initial,
        initialBalanceDate: date,
        creditLimitCents: limit,
        closingDay,
        dueDay,
        shareWith,
        shareAccess,
        idempotencyKey: key.current,
      });
      key.renew();
      formEl.reset();
      setKind('checking');
      setSuccess(`“${created.name}” cadastrada.`);
      await reload();
    } catch (err) {
      setError(toUserMessage(err, 'criar conta'));
    } finally {
      setSubmitting(false);
    }
  }

  const visible = data.accounts;
  return (
    <div className="space-y-6">
      {success && <SuccessState message={success} />}
      {visible.length === 0 ? (
        <EmptyState title="Nenhuma conta neste espaço" description="Cadastre abaixo sua conta corrente, poupança, carteira ou cartão." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              editing={editing === a.id}
              onEdit={() => setEditing(editing === a.id ? null : a.id)}
              onDone={async (message) => {
                setEditing(null);
                setSuccess(message);
                await reload();
              }}
              onError={setError}
              isOwner={a.owner_user_id === me}
              ownerName={memberName(a.owner_user_id)}
            />
          ))}
        </ul>
      )}

      {canCreate ? (
        <form onSubmit={handleCreate} noValidate aria-labelledby="titulo-nova-conta" className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <h2 id="titulo-nova-conta" className="text-lg font-semibold">
            Nova conta ou cartão
          </h2>
          {error && <ErrorState message={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="conta-nome" label="Nome">
              <TextInput id="conta-nome" name="name" maxLength={60} required />
            </Field>
            <Field id="conta-tipo" label="Tipo">
              <Select id="conta-tipo" name="kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                {Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'credit_card' ? (
              <>
                <Field id="conta-limite" label="Limite (R$)">
                  <MoneyInput id="conta-limite" name="limit" />
                </Field>
                <Field id="conta-fechamento" label="Dia de fechamento" hint="Compras a partir deste dia vão para a fatura seguinte.">
                  <TextInput id="conta-fechamento" name="closing_day" type="number" min={1} max={28} aria-describedby="conta-fechamento-hint" />
                </Field>
                <Field id="conta-vencimento" label="Dia de vencimento">
                  <TextInput id="conta-vencimento" name="due_day" type="number" min={1} max={28} />
                </Field>
              </>
            ) : (
              <>
                <Field id="conta-saldo" label="Saldo inicial (R$)" hint="Pode ser negativo (cheque especial).">
                  <MoneyInput id="conta-saldo" name="initial" aria-describedby="conta-saldo-hint" />
                </Field>
                <Field id="conta-data" label="Data do saldo inicial" hint="Lançamentos anteriores a esta data não são aceitos.">
                  <TextInput id="conta-data" name="initial_date" type="date" aria-describedby="conta-data-hint" />
                </Field>
              </>
            )}
          </div>
          {active?.kind === 'family' && others.length > 0 && (
            <fieldset className="space-y-2 rounded-lg border border-ink/15 p-4">
              <legend className="px-1 text-sm font-medium">Compartilhar esta conta</legend>
              <p className="text-xs text-ink/70">
                Sem compartilhar, só você vê a conta, mesmo estando no espaço da família. Você pode mudar isso depois.
              </p>
              {others.map((m) => (
                <label key={m.user_id} className="flex items-center gap-2">
                  <input type="checkbox" name={`share-${m.user_id}`} defaultChecked /> {m.display_name ?? 'Outro membro'}
                </label>
              ))}
              <Field id="conta-acesso" label="Permissão">
                <Select id="conta-acesso" name="share_access" defaultValue="write">
                  <option value="write">Pode ver e lançar</option>
                  <option value="read">Só pode ver</option>
                </Select>
              </Field>
            </fieldset>
          )}
          <Button type="submit" loading={submitting}>
            Cadastrar
          </Button>
        </form>
      ) : (
        <p className="text-sm text-ink/70">Seu papel neste espaço é somente consulta.</p>
      )}
    </div>
  );
}

function AccountCard({
  account: a,
  editing,
  onEdit,
  onDone,
  onError,
  isOwner,
  ownerName,
}: {
  account: Account;
  editing: boolean;
  onEdit(): void;
  onDone(message: string): Promise<void>;
  onError(message: string): void;
  isOwner: boolean;
  ownerName: string;
}) {
  const { finance } = useServices();
  const { data, memberName } = useFinance();
  const balance = data.balances[a.id];
  const grants = data.grants.filter((g) => g.account_id === a.id && g.user_id !== a.owner_user_id);
  const others = data.members.filter((m) => m.user_id !== a.owner_user_id);
  const [saving, setSaving] = useState(false);

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return onError('Informe um nome.');
    setSaving(true);
    try {
      if (a.kind === 'credit_card') {
        const limit = parsePositiveAmount(form.get('limit'));
        if ('error' in limit) return onError(`Limite: ${limit.error}`);
        const closingDay = parseDay(form.get('closing_day'));
        const dueDay = parseDay(form.get('due_day'));
        if (!closingDay || !dueDay) return onError('Dias de fechamento e vencimento devem estar entre 1 e 28.');
        await finance.updateAccount({ accountId: a.id, expectedVersion: a.version, name, initialBalanceCents: null, initialBalanceDate: null, creditLimitCents: limit.cents, closingDay, dueDay });
      } else {
        const initial = parseSignedAmount(form.get('initial'));
        if ('error' in initial) return onError(initial.error);
        await finance.updateAccount({
          accountId: a.id,
          expectedVersion: a.version,
          name,
          initialBalanceCents: initial.cents,
          initialBalanceDate: String(form.get('initial_date') || a.initial_balance_date),
          creditLimitCents: null,
          closingDay: null,
          dueDay: null,
        });
      }
      await onDone(`“${name}” atualizada.`);
    } catch (err) {
      onError(toUserMessage(err, 'atualizar conta'));
    } finally {
      setSaving(false);
    }
  }

  async function setShare(userId: string, access: GrantAccess | 'none') {
    try {
      if (access === 'none') await finance.revokeAccess(a.id, userId);
      else await finance.grantAccess(a.id, userId, access);
      await onDone('Compartilhamento atualizado.');
    } catch (err) {
      onError(toUserMessage(err, 'compartilhar conta'));
    }
  }

  return (
    <li className={`space-y-3 rounded-xl bg-white p-4 shadow-sm ${a.is_active ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{a.name}</p>
          <p className="text-sm text-ink/70">
            {ACCOUNT_KIND_LABEL[a.kind]} · titular: {ownerName}
            {!a.is_active && ' · desativada'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">
            <Amount value={balance?.balance_cents ?? 0} tone="signed" />
          </p>
          {a.kind === 'credit_card' && balance?.available_credit_cents != null && (
            <p className="text-xs text-ink/70">
              Disponível <Amount value={balance.available_credit_cents} /> de <Amount value={a.credit_limit_cents ?? 0} />
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-ink/70">
        {a.kind === 'credit_card'
          ? `Fecha dia ${a.closing_day}, vence dia ${a.due_day}.`
          : `Saldo inicial de ${formatBusinessDate(a.initial_balance_date)}.`}
        {balance && balance.pending_expense_cents > 0 && (
          <>
            {' '}
            A pagar: <Amount value={balance.pending_expense_cents} />.
          </>
        )}
      </p>
      <p className="text-xs text-ink/70">
        {grants.length === 0
          ? 'Não compartilhada.'
          : `Compartilhada com: ${grants.map((g) => `${memberName(g.user_id)} (${g.access === 'write' ? 'vê e lança' : 'só vê'})`).join(', ')}.`}
      </p>

      {isOwner && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="text-sm" onClick={onEdit} aria-expanded={editing}>
            {editing ? 'Fechar edição' : 'Editar'}
          </Button>
          <ConfirmButton
            label={a.is_active ? 'Desativar' : 'Reativar'}
            question={a.is_active ? 'Desativar? O histórico é mantido.' : 'Reativar a conta?'}
            onConfirm={async () => {
              try {
                await finance.setAccountActive(a.id, a.version, !a.is_active);
                await onDone(a.is_active ? `“${a.name}” desativada.` : `“${a.name}” reativada.`);
              } catch (err) {
                onError(toUserMessage(err, 'alterar situação da conta'));
              }
            }}
          />
        </div>
      )}

      {isOwner && editing && (
        <form onSubmit={handleEdit} noValidate className="space-y-3 border-t border-ink/10 pt-3" aria-label={`Editar ${a.name}`}>
          <Field id={`edit-nome-${a.id}`} label="Nome">
            <TextInput id={`edit-nome-${a.id}`} name="name" defaultValue={a.name} maxLength={60} />
          </Field>
          {a.kind === 'credit_card' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={`edit-limite-${a.id}`} label="Limite (R$)">
                <MoneyInput id={`edit-limite-${a.id}`} name="limit" defaultValue={toInputMoney(a.credit_limit_cents ?? 0)} />
              </Field>
              <Field id={`edit-fech-${a.id}`} label="Fechamento">
                <TextInput id={`edit-fech-${a.id}`} name="closing_day" type="number" min={1} max={28} defaultValue={a.closing_day ?? ''} />
              </Field>
              <Field id={`edit-venc-${a.id}`} label="Vencimento">
                <TextInput id={`edit-venc-${a.id}`} name="due_day" type="number" min={1} max={28} defaultValue={a.due_day ?? ''} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`edit-saldo-${a.id}`} label="Saldo inicial (R$)">
                <MoneyInput id={`edit-saldo-${a.id}`} name="initial" defaultValue={toInputMoney(a.initial_balance_cents)} />
              </Field>
              <Field id={`edit-data-${a.id}`} label="Data do saldo inicial">
                <TextInput id={`edit-data-${a.id}`} name="initial_date" type="date" defaultValue={a.initial_balance_date} />
              </Field>
            </div>
          )}
          <Button type="submit" loading={saving}>
            Salvar
          </Button>
        </form>
      )}

      {isOwner && editing && others.length > 0 && (
        <fieldset className="space-y-2 border-t border-ink/10 pt-3">
          <legend className="text-sm font-medium">Compartilhamento</legend>
          {others.map((m) => {
            const current = grants.find((g) => g.user_id === m.user_id)?.access ?? 'none';
            return (
              <div key={m.user_id} className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor={`share-${a.id}-${m.user_id}`}>{m.display_name ?? 'Outro membro'}</label>
                <Select
                  id={`share-${a.id}-${m.user_id}`}
                  className="w-auto"
                  value={current}
                  onChange={(e) => void setShare(m.user_id, e.target.value as GrantAccess | 'none')}
                >
                  <option value="none">Sem acesso</option>
                  <option value="read">Só vê</option>
                  <option value="write">Vê e lança</option>
                </Select>
              </div>
            );
          })}
        </fieldset>
      )}
    </li>
  );
}
