import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useServices } from '@/app/services';
import { Field, MoneyInput, Select, TextInput } from '@/components/form/Field';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '@/components/ui/StatusViews';
import { formatBusinessDate, formatMonth, toBusinessDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { allocateCents, cents, centsToDecimalString, formatCents } from '@/lib/money';
import { useFinance } from './FinanceContext';
import { AccountOptions, PageHeader, SpaceGate, parsePositiveAmount, useIdempotencyKey, useWritableAccounts } from './shared';
import { STATEMENT_STATUS_LABEL, type Account, type CardPurchase, type CardStatement } from './types';

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; statements: CardStatement[]; purchases: CardPurchase[] };

export function CardsPage() {
  return (
    <section aria-labelledby="titulo-cartoes" className="space-y-6">
      <PageHeader id="titulo-cartoes" title="Cartões" description="Compras, parcelas e faturas. Pagar a fatura não conta como nova despesa." />
      <SpaceGate>
        <Cards />
      </SpaceGate>
    </section>
  );
}

function Cards() {
  const { data } = useFinance();
  const cards = data.accounts.filter((a) => a.kind === 'credit_card');
  const [selected, setSelected] = useState<string>('');
  const card = cards.find((c) => c.id === selected) ?? cards[0];

  if (!card) {
    return (
      <EmptyState
        title="Nenhum cartão neste espaço"
        description="Cadastre um cartão de crédito com limite e dias de fechamento e vencimento."
        action={
          <Link to="/contas" className="rounded-lg bg-brand-900 px-4 py-2 text-sm font-semibold text-white">
            Cadastrar cartão
          </Link>
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      {cards.length > 1 && (
        <Field id="cartao-ativo" label="Cartão">
          <Select id="cartao-ativo" value={card.id} onChange={(e) => setSelected(e.target.value)} className="w-auto">
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <CardDetail key={card.id} card={card} />
    </div>
  );
}

function CardDetail({ card }: { card: Account }) {
  const { finance } = useServices();
  const { active, data, reload, memberName } = useFinance();
  const { writable, accounts } = useWritableAccounts();
  const canWrite = writable(card);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balance = data.balances[card.id];

  const fetchAll = useCallback(
    (): Promise<Loaded> =>
      Promise.all([finance.cardStatements(card.id), finance.listCardPurchases(card.id)]).then(
        ([statements, purchases]): Loaded => ({ status: 'ready', statements, purchases }),
        (err: unknown): Loaded => ({ status: 'error', message: toUserMessage(err, 'carregar cartão') }),
      ),
    [finance, card.id],
  );

  useEffect(() => {
    let alive = true;
    void fetchAll().then((next) => alive && setLoaded(next));
    return () => {
      alive = false;
    };
  }, [fetchAll, data]);

  const done = async (message: string) => {
    setNotice(message);
    setError(null);
    await reload();
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-ink/70">Limite</p>
          <p className="text-xl font-bold">
            <Amount value={card.credit_limit_cents ?? 0} />
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-ink/70">Disponível</p>
          <p className="text-xl font-bold">
            <Amount value={balance?.available_credit_cents ?? 0} tone="signed" />
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-ink/70">Fechamento / vencimento</p>
          <p className="text-xl font-bold">
            Dia {card.closing_day} / dia {card.due_day}
          </p>
        </div>
      </div>
      {notice && <SuccessState message={notice} />}
      {error && <ErrorState message={error} />}

      {canWrite ? <PurchaseForm card={card} onDone={done} /> : <p className="text-sm text-ink/70">Você só pode consultar este cartão.</p>}

      {loaded.status === 'loading' && <LoadingState label="Carregando faturas…" />}
      {loaded.status === 'error' && (
        <ErrorState
          message={loaded.message}
          action={
            <Button variant="secondary" onClick={() => void fetchAll().then(setLoaded)}>
              Tentar de novo
            </Button>
          }
        />
      )}
      {loaded.status === 'ready' && (
        <>
          <section aria-labelledby="titulo-faturas" className="rounded-xl bg-white p-4 shadow-sm">
            <h2 id="titulo-faturas" className="mb-3 font-semibold">
              Faturas
            </h2>
            {loaded.statements.length === 0 ? (
              <p className="text-sm text-ink/70">Nenhuma compra registrada neste cartão.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {loaded.statements.map((s) => (
                  <StatementRow
                    key={s.statement_month}
                    card={card}
                    statement={s}
                    payFrom={canWrite ? accounts.filter((a) => a.kind !== 'credit_card') : []}
                    today={toBusinessDate(new Date(), active?.timezone)}
                    onDone={done}
                    onError={setError}
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="titulo-compras" className="rounded-xl bg-white p-4 shadow-sm">
            <h2 id="titulo-compras" className="mb-3 font-semibold">
              Compras
            </h2>
            {loaded.purchases.length === 0 ? (
              <p className="text-sm text-ink/70">Nenhuma compra registrada.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {loaded.purchases.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${p.status === 'cancelled' ? 'opacity-60' : ''}`}>
                    <span>
                      <span className={p.status === 'cancelled' ? 'line-through' : ''}>{p.description}</span>
                      <span className="block text-xs text-ink/70">
                        {formatBusinessDate(p.purchased_on)} · {p.installment_count > 1 ? `${p.installment_count}x` : 'à vista'} · {memberName(p.attributed_to)}
                        {p.status === 'cancelled' && ' · estornada'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Amount value={p.total_cents} />
                      {canWrite && p.status === 'active' && (
                        <ConfirmButton
                          label="Estornar compra"
                          question="Estornar todas as parcelas?"
                          confirmLabel="Sim, estornar"
                          onConfirm={async () => {
                            try {
                              await finance.cancelCardPurchase(p.id, p.version);
                              await done(`Compra “${p.description}” estornada.`);
                            } catch (err) {
                              setError(toUserMessage(err, 'estornar compra'));
                            }
                          }}
                        />
                      )}
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

function StatementRow({
  card,
  statement: s,
  payFrom,
  today,
  onDone,
  onError,
}: {
  card: Account;
  statement: CardStatement;
  payFrom: Account[];
  today: string;
  onDone(message: string): Promise<void>;
  onError(message: string): void;
}) {
  const { finance } = useServices();
  const [paying, setPaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const key = useIdempotencyKey();

  async function handlePay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = parsePositiveAmount(form.get('amount'));
    if ('error' in amount) return onError(amount.error);
    const fromAccountId = String(form.get('from') ?? '');
    if (!fromAccountId) return onError('Escolha a conta de onde sai o pagamento.');
    setSaving(true);
    try {
      await finance.payStatement({
        cardAccountId: card.id,
        statementMonth: s.statement_month,
        fromAccountId,
        amountCents: amount.cents,
        paidOn: String(form.get('paid_on') || today),
        idempotencyKey: key.current,
      });
      key.renew();
      setPaying(false);
      await onDone('Pagamento da fatura registrado.');
    } catch (err) {
      onError(toUserMessage(err, 'pagar fatura'));
    } finally {
      setSaving(false);
    }
  }

  const remainingText = centsToDecimalString(cents(s.remaining_cents)).replace('.', ',');
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium capitalize">{formatMonth(s.statement_month)}</span>
          <span className="block text-xs text-ink/70">
            Fecha {formatBusinessDate(s.closing_date)} · vence {formatBusinessDate(s.due_date)} · {STATEMENT_STATUS_LABEL[s.status]}
          </span>
        </span>
        <span className="text-right">
          <Amount value={s.total_cents} />
          {s.paid_cents > 0 && (
            <span className="block text-xs text-ink/70">
              Pago <Amount value={s.paid_cents} /> · falta <Amount value={s.remaining_cents} />
            </span>
          )}
        </span>
      </div>
      {payFrom.length > 0 && s.remaining_cents > 0 && (
        <Button variant="secondary" className="text-sm" aria-expanded={paying} onClick={() => setPaying(!paying)}>
          {paying ? 'Fechar' : 'Pagar fatura'}
        </Button>
      )}
      {paying && (
        <form onSubmit={handlePay} noValidate aria-label={`Pagar fatura de ${formatMonth(s.statement_month)}`} className="grid gap-3 sm:grid-cols-3">
          <Field id={`pag-valor-${s.statement_month}`} label="Valor (R$)">
            <MoneyInput id={`pag-valor-${s.statement_month}`} name="amount" defaultValue={remainingText} />
          </Field>
          <Field id={`pag-conta-${s.statement_month}`} label="Pagar com">
            <Select id={`pag-conta-${s.statement_month}`} name="from" defaultValue="">
              <AccountOptions accounts={payFrom} />
            </Select>
          </Field>
          <Field id={`pag-data-${s.statement_month}`} label="Data do pagamento">
            <TextInput id={`pag-data-${s.statement_month}`} name="paid_on" type="date" defaultValue={today} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" loading={saving}>
              Registrar pagamento
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function PurchaseForm({ card, onDone }: { card: Account; onDone(message: string): Promise<void> }) {
  const { finance } = useServices();
  const { active, data, memberName } = useFinance();
  const { me } = useWritableAccounts();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const key = useIdempotencyKey();
  const categories = data.categories.filter((c) => c.kind === 'expense' && c.is_active);

  function updatePreview(form: HTMLFormElement) {
    const fd = new FormData(form);
    const amount = parsePositiveAmount(fd.get('amount'));
    const n = Number(fd.get('installments'));
    if ('error' in amount || !Number.isInteger(n) || n < 1 || n > 48 || amount.cents < n) return setPreview(null);
    const parts = allocateCents(cents(amount.cents), n);
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const fmt = (v: number) => formatCents(cents(v));
    setPreview(n === 1 ? null : first === last ? `${n}x de ${fmt(first)}` : `1ª de ${fmt(first)} e demais de ${fmt(last)}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const amount = parsePositiveAmount(form.get('amount'));
    if ('error' in amount) return setError(amount.error);
    const installments = Number(form.get('installments'));
    if (!Number.isInteger(installments) || installments < 1 || installments > 48) return setError('Parcelas devem ser de 1 a 48.');
    const description = String(form.get('description') ?? '').trim();
    if (!description) return setError('Informe a descrição.');
    setError(null);
    setSubmitting(true);
    try {
      await finance.createCardPurchase({
        cardAccountId: card.id,
        totalCents: amount.cents,
        installmentCount: installments,
        purchasedOn: String(form.get('purchased_on') ?? ''),
        description,
        categoryId: String(form.get('category_id') ?? '') || null,
        attributedTo: String(form.get('attributed_to') ?? '') || null,
        idempotencyKey: key.current,
      });
      key.renew();
      formEl.reset();
      setPreview(null);
      await onDone('Compra registrada.');
    } catch (err) {
      setError(toUserMessage(err, 'registrar compra'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onInput={(e) => updatePreview(e.currentTarget)}
      noValidate
      aria-labelledby="titulo-nova-compra"
      className="space-y-4 rounded-xl bg-white p-6 shadow-sm"
    >
      <h2 id="titulo-nova-compra" className="text-lg font-semibold">
        Nova compra em {card.name}
      </h2>
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="compra-descricao" label="Descrição">
          <TextInput id="compra-descricao" name="description" maxLength={120} />
        </Field>
        <Field id="compra-valor" label="Valor total (R$)">
          <MoneyInput id="compra-valor" name="amount" />
        </Field>
        <Field id="compra-parcelas" label="Parcelas" hint={preview ?? 'Total dividido em centavos exatos.'}>
          <TextInput id="compra-parcelas" name="installments" type="number" min={1} max={48} defaultValue={1} aria-describedby="compra-parcelas-hint" />
        </Field>
        <Field id="compra-data" label="Data da compra">
          <TextInput id="compra-data" name="purchased_on" type="date" defaultValue={toBusinessDate(new Date(), active?.timezone)} />
        </Field>
        <Field id="compra-categoria" label="Categoria">
          <Select id="compra-categoria" name="category_id" defaultValue="">
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="compra-pessoa" label="Gasto de">
          <Select id="compra-pessoa" name="attributed_to" defaultValue={me ?? ''}>
            <option value="">Não atribuído</option>
            {data.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberName(m.user_id)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" loading={submitting}>
        Registrar compra
      </Button>
    </form>
  );
}
