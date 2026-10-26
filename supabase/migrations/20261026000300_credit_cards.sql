-- =============================================================================
-- Migração 0006 — Cartões de crédito: compras parceladas, faturas e pagamentos
-- -----------------------------------------------------------------------------
-- Modelo:
--   * O cartão é uma conta `credit_card` com limite, dia de fechamento e dia
--     de vencimento (1 a 28, para existir em todos os meses).
--   * Compra = `card_purchases` + uma parcela `card_charge` por mês de fatura.
--     O total é dividido em centavos inteiros; o resto vai para as primeiras
--     parcelas (mesma regra de `allocateCents` no frontend).
--   * Fatura de referência M: fecha no dia de fechamento de M e vence no dia
--     de vencimento de M (se vencimento > fechamento) ou de M+1.
--     Compra feita ANTES do dia de fechamento entra na fatura do mês; no dia
--     do fechamento ou depois, entra na fatura seguinte.
--   * Pagamento da fatura = transferência da conta bancária para o cartão
--     (`card_payment_out` + `card_payment_in`). NÃO é despesa: a despesa é a
--     compra. Assim nada é contado duas vezes.
--   * A fatura é derivada dos lançamentos; nada fica armazenado em duplicidade.
-- =============================================================================

create function app_private.statement_month_for(p_closing_day smallint, p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(day from p_date) < p_closing_day then date_trunc('month', p_date)::date
    else (date_trunc('month', p_date) + interval '1 month')::date
  end;
$$;

create function app_private.statement_closing_date(p_statement_month date, p_closing_day smallint)
returns date
language sql
immutable
set search_path = ''
as $$ select p_statement_month + (p_closing_day - 1) $$;

create function app_private.statement_due_date(p_statement_month date, p_closing_day smallint, p_due_day smallint)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_due_day > p_closing_day then p_statement_month + (p_due_day - 1)
    else (p_statement_month + interval '1 month')::date + (p_due_day - 1)
  end;
$$;

revoke all on function app_private.statement_month_for(smallint, date) from public;
revoke all on function app_private.statement_closing_date(date, smallint) from public;
revoke all on function app_private.statement_due_date(date, smallint, smallint) from public;
grant execute on function app_private.statement_month_for(smallint, date) to authenticated;
grant execute on function app_private.statement_closing_date(date, smallint) to authenticated;
grant execute on function app_private.statement_due_date(date, smallint, smallint) to authenticated;

-- -----------------------------------------------------------------------------
-- Compra no cartão (à vista ou parcelada)
-- -----------------------------------------------------------------------------
create function public.create_card_purchase(
  p_card_account_id uuid,
  p_total_cents bigint,
  p_installment_count smallint,
  p_purchased_on date,
  p_description text,
  p_idempotency_key uuid,
  p_category_id uuid default null,
  p_attributed_to uuid default null
)
returns public.card_purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := app_private.require_user();
  v_card        public.accounts := app_private.lock_writable_account(p_card_account_id);
  v_description text;
  v_existing    uuid;
  v_purchase    public.card_purchases;
  v_first_month date;
  v_base        bigint;
  v_remainder   bigint;
  i             integer;
begin
  v_existing := app_private.idem_begin('create_card_purchase', p_idempotency_key, md5(format(
    '%L|%L|%L|%L|%L|%L|%L', p_card_account_id, p_total_cents, p_installment_count, p_purchased_on,
    btrim(coalesce(p_description, '')), p_category_id, p_attributed_to)));
  if v_existing is not null then
    select * into v_purchase from public.card_purchases p where p.id = v_existing;
    return v_purchase;
  end if;

  if v_card.kind <> 'credit_card' then
    raise exception 'A conta escolhida não é um cartão' using errcode = 'check_violation';
  end if;
  if p_installment_count is null or p_installment_count not between 1 and 48 then
    raise exception 'Parcelas devem ser de 1 a 48' using errcode = 'check_violation';
  end if;
  v_description := app_private.validate_entry_fields(v_card, p_total_cents, p_purchased_on, p_description,
    p_category_id, 'expense', p_attributed_to);
  if p_total_cents < p_installment_count then
    raise exception 'Valor menor que o número de parcelas' using errcode = 'check_violation';
  end if;

  insert into public.card_purchases (
    household_id, card_account_id, description, total_cents, installment_count, purchased_on,
    category_id, attributed_to, created_by
  ) values (
    v_card.household_id, v_card.id, v_description, p_total_cents, p_installment_count, p_purchased_on,
    p_category_id, p_attributed_to, v_user
  ) returning * into v_purchase;

  v_first_month := app_private.statement_month_for(v_card.closing_day, p_purchased_on);
  v_base := p_total_cents / p_installment_count;
  v_remainder := p_total_cents % p_installment_count;

  for i in 1..p_installment_count loop
    insert into public.transactions (
      household_id, account_id, kind, status, amount_cents, occurred_on, description,
      category_id, attributed_to, purchase_id, installment_number, installment_count, statement_month, created_by
    ) values (
      v_card.household_id, v_card.id, 'card_charge', 'posted',
      v_base + case when i <= v_remainder then 1 else 0 end,
      (p_purchased_on + make_interval(months => i - 1))::date,
      v_description, p_category_id, p_attributed_to, v_purchase.id, i, p_installment_count,
      (v_first_month + make_interval(months => i - 1))::date, v_user
    );
  end loop;

  perform app_private.idem_finish('create_card_purchase', p_idempotency_key, v_purchase.id);
  perform app_private.audit(v_card.household_id, 'card_purchase.created', v_purchase.id,
    jsonb_build_object('installments', p_installment_count));
  return v_purchase;
end;
$$;

-- Estorno da compra inteira: todas as parcelas são canceladas (histórico preservado).
create function public.cancel_card_purchase(p_purchase_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := app_private.require_user();
  v_purchase public.card_purchases;
begin
  select * into v_purchase from public.card_purchases p where p.id = p_purchase_id;
  if v_purchase.id is null then
    raise exception 'Sem permissão para lançar nesta conta' using errcode = 'insufficient_privilege';
  end if;
  perform app_private.lock_writable_account(v_purchase.card_account_id, false);
  select * into v_purchase from public.card_purchases p where p.id = p_purchase_id for update;

  if v_purchase.status = 'cancelled' then
    raise exception 'Compra já cancelada' using errcode = 'check_violation';
  end if;
  if v_purchase.version <> p_expected_version then
    raise exception 'A compra foi alterada por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;

  update public.card_purchases p
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user
  where p.id = p_purchase_id;

  update public.transactions t
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user
  where t.purchase_id = p_purchase_id and t.status <> 'cancelled';

  perform app_private.audit(v_purchase.household_id, 'card_purchase.cancelled', p_purchase_id);
end;
$$;

-- Pagamento (total ou parcial) de uma fatura a partir de uma conta comum.
create function public.pay_card_statement(
  p_card_account_id uuid,
  p_statement_month date,
  p_from_account_id uuid,
  p_amount_cents bigint,
  p_paid_on date,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := app_private.require_user();
  v_card     public.accounts;
  v_from     public.accounts;
  v_existing uuid;
  v_transfer uuid := gen_random_uuid();
  v_out_id   uuid;
  v_month    date := date_trunc('month', p_statement_month)::date;
  v_label    text;
begin
  v_existing := app_private.idem_begin('pay_card_statement', p_idempotency_key, md5(format(
    '%L|%L|%L|%L|%L', p_card_account_id, v_month, p_from_account_id, p_amount_cents, p_paid_on)));
  if v_existing is not null then
    select t.transfer_id into v_transfer from public.transactions t where t.id = v_existing;
    return v_transfer;
  end if;

  if p_card_account_id is null or p_from_account_id is null or p_card_account_id = p_from_account_id then
    raise exception 'Escolha o cartão e a conta de pagamento' using errcode = 'check_violation';
  end if;
  if p_card_account_id < p_from_account_id then
    v_card := app_private.lock_writable_account(p_card_account_id, false);
    v_from := app_private.lock_writable_account(p_from_account_id);
  else
    v_from := app_private.lock_writable_account(p_from_account_id);
    v_card := app_private.lock_writable_account(p_card_account_id, false);
  end if;
  if v_card.kind <> 'credit_card' or v_from.kind = 'credit_card' then
    raise exception 'Pague a fatura do cartão a partir de uma conta comum' using errcode = 'check_violation';
  end if;
  if v_month is null then
    raise exception 'Mês da fatura obrigatório' using errcode = 'invalid_parameter_value';
  end if;

  v_label := 'Pagamento da fatura ' || to_char(v_month, 'MM/YYYY') || ' — ' || v_card.name;
  v_label := left(v_label, 120);
  perform app_private.validate_entry_fields(v_from, p_amount_cents, p_paid_on, v_label, null, 'expense', null);

  insert into public.transactions (household_id, account_id, kind, amount_cents, occurred_on, description,
    transfer_id, statement_month, created_by)
  values (v_from.household_id, v_from.id, 'card_payment_out', p_amount_cents, p_paid_on, v_label,
    v_transfer, v_month, v_user)
  returning id into v_out_id;
  insert into public.transactions (household_id, account_id, kind, amount_cents, occurred_on, description,
    transfer_id, statement_month, created_by)
  values (v_card.household_id, v_card.id, 'card_payment_in', p_amount_cents, p_paid_on, v_label,
    v_transfer, v_month, v_user);

  perform app_private.idem_finish('pay_card_statement', p_idempotency_key, v_out_id);
  perform app_private.audit(v_card.household_id, 'card_statement.paid', v_transfer);
  return v_transfer;
end;
$$;

-- Faturas de um cartão, derivadas das parcelas e pagamentos visíveis ao chamador.
-- Situação: open (antes do fechamento), closed (fechada, a vencer),
-- overdue (vencida com saldo), paid (quitada).
create function public.card_statements(p_card_account_id uuid)
returns table (
  statement_month date,
  closing_date date,
  due_date date,
  total_cents bigint,
  paid_cents bigint,
  remaining_cents bigint,
  status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with card as (
    select a.id, a.household_id, a.closing_day, a.due_day
    from public.accounts a
    where a.id = p_card_account_id and a.kind = 'credit_card'
  ),
  sums as (
    select t.statement_month,
      coalesce(sum(t.amount_cents) filter (where t.kind = 'card_charge'), 0)::bigint as total_cents,
      coalesce(sum(t.amount_cents) filter (where t.kind = 'card_payment_in'), 0)::bigint as paid_cents
    from public.transactions t
    join card c on c.id = t.account_id
    where t.status = 'posted'
    group by t.statement_month
  )
  select s.statement_month,
    app_private.statement_closing_date(s.statement_month, c.closing_day),
    app_private.statement_due_date(s.statement_month, c.closing_day, c.due_day),
    s.total_cents,
    s.paid_cents,
    greatest(s.total_cents - s.paid_cents, 0),
    case
      when s.total_cents - s.paid_cents <= 0 then 'paid'
      when app_private.household_today(c.household_id) < app_private.statement_closing_date(s.statement_month, c.closing_day) then 'open'
      when app_private.household_today(c.household_id) > app_private.statement_due_date(s.statement_month, c.closing_day, c.due_day) then 'overdue'
      else 'closed'
    end
  from sums s
  cross join card c
  order by s.statement_month;
$$;

revoke all on function public.create_card_purchase(uuid, bigint, smallint, date, text, uuid, uuid, uuid) from public, anon;
revoke all on function public.cancel_card_purchase(uuid, integer) from public, anon;
revoke all on function public.pay_card_statement(uuid, date, uuid, bigint, date, uuid) from public, anon;
revoke all on function public.card_statements(uuid) from public, anon;
grant execute on function public.create_card_purchase(uuid, bigint, smallint, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_card_purchase(uuid, integer) to authenticated;
grant execute on function public.pay_card_statement(uuid, date, uuid, bigint, date, uuid) to authenticated;
grant execute on function public.card_statements(uuid) to authenticated;
