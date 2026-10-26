-- =============================================================================
-- Migração 0007 — Resumo mensal e importação de extratos (OFX/CSV)
-- -----------------------------------------------------------------------------
-- Resumo (security invoker: só soma o que o chamador pode ver):
--   * receitas = receitas efetivadas com data no mês;
--   * despesas = despesas efetivadas com data no mês + parcelas de cartão cuja
--     FATURA é do mês (competência da fatura). Pagamento de fatura e
--     transferências não entram;
--   * resultado = receitas − despesas;
--   * saldo disponível = soma dos saldos atuais das contas comuns ativas;
--   * obrigações = contas a pagar pendentes do mês e faturas que vencem no mês.
-- Importação:
--   * o arquivo é lido no navegador; o banco recebe só as linhas normalizadas
--     (data, valor com sinal em centavos, descrição, identificador);
--   * duplicidade = mesmo identificador externo na mesma conta (em qualquer
--     situação). "Possível duplicado" = lançamento manual com mesma data e valor;
--   * cada linha é validada isoladamente; inválidas são rejeitadas com motivo.
-- =============================================================================

create function public.monthly_summary(p_household_id uuid, p_month date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date as m_end
  ),
  visible as (
    select t.*
    from public.transactions t
    where t.household_id = p_household_id and t.status <> 'cancelled'
  ),
  expenses as (
    select v.amount_cents, v.category_id, v.attributed_to
    from visible v, bounds b
    where v.status = 'posted'
      and ((v.kind = 'expense' and v.occurred_on between b.m_start and b.m_end)
        or (v.kind = 'card_charge' and v.statement_month = b.m_start))
  ),
  incomes as (
    select v.amount_cents, v.category_id, v.attributed_to
    from visible v, bounds b
    where v.status = 'posted' and v.kind = 'income' and v.occurred_on between b.m_start and b.m_end
  ),
  pending as (
    select v.id, v.kind, v.amount_cents, v.occurred_on, v.description, v.account_id, v.version
    from visible v, bounds b
    where v.status = 'pending' and v.occurred_on between b.m_start and b.m_end
  ),
  balances as (
    select ab.account_id, ab.kind, ab.balance_cents, ab.available_credit_cents, a.name, a.is_active
    from public.account_balances ab
    join public.accounts a on a.id = ab.account_id
    where ab.household_id = p_household_id
  ),
  statements as (
    select a.id as card_account_id, a.name as card_name, s.*
    from public.accounts a
    cross join lateral public.card_statements(a.id) s
    , bounds b
    where a.household_id = p_household_id and a.kind = 'credit_card'
      and s.due_date between b.m_start and b.m_end
  )
  select jsonb_build_object(
    'month', (select m_start from bounds),
    'income_cents', coalesce((select sum(amount_cents) from incomes), 0),
    'expense_cents', coalesce((select sum(amount_cents) from expenses), 0),
    'result_cents', coalesce((select sum(amount_cents) from incomes), 0)
                  - coalesce((select sum(amount_cents) from expenses), 0),
    'available_cents', coalesce((select sum(balance_cents) from balances where kind <> 'credit_card' and is_active), 0),
    'card_debt_cents', coalesce((select -sum(balance_cents) from balances where kind = 'credit_card'), 0),
    'pending_expense_cents', coalesce((select sum(amount_cents) from pending where kind = 'expense'), 0),
    'pending_income_cents', coalesce((select sum(amount_cents) from pending where kind = 'income'), 0),
    'statements_due_cents', coalesce((select sum(remaining_cents) from statements), 0),
    'expenses_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', x.category_id, 'name', x.name, 'total_cents', x.total)
                       order by x.total desc)
      from (
        select e.category_id, c.name, sum(e.amount_cents) as total
        from expenses e left join public.categories c on c.id = e.category_id
        group by e.category_id, c.name
      ) x), '[]'::jsonb),
    'expenses_by_member', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.attributed_to, 'display_name', x.display_name, 'total_cents', x.total)
                       order by x.total desc)
      from (
        select e.attributed_to, p.display_name, sum(e.amount_cents) as total
        from expenses e left join public.profiles p on p.id = e.attributed_to
        group by e.attributed_to, p.display_name
      ) x), '[]'::jsonb),
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', account_id, 'name', name, 'kind', kind,
                       'balance_cents', balance_cents, 'available_credit_cents', available_credit_cents,
                       'is_active', is_active) order by kind, name)
      from balances), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'amount_cents', amount_cents,
                       'occurred_on', occurred_on, 'description', description, 'account_id', account_id,
                       'version', version) order by occurred_on)
      from pending), '[]'::jsonb),
    'statements_due', coalesce((
      select jsonb_agg(jsonb_build_object('card_account_id', card_account_id, 'card_name', card_name,
                       'statement_month', statement_month, 'due_date', due_date, 'total_cents', total_cents,
                       'paid_cents', paid_cents, 'remaining_cents', remaining_cents, 'status', status)
                       order by due_date)
      from statements), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Importação
-- -----------------------------------------------------------------------------
-- Formato de cada linha: {"occurred_on": "AAAA-MM-DD", "amount_cents": -1234,
--   "description": "...", "external_id": "..."}. Valor negativo = saída.
create function app_private.parse_import_row(p_row jsonb, p_account public.accounts,
  out occurred_on date, out amount_cents bigint, out description text, out external_id text, out reason text)
language plpgsql
stable
set search_path = ''
as $$
begin
  reason := null;
  begin
    occurred_on := (p_row ->> 'occurred_on')::date;
    amount_cents := (p_row ->> 'amount_cents')::bigint;
  exception when others then
    reason := 'Data ou valor inválido';
    return;
  end;
  description := left(btrim(coalesce(p_row ->> 'description', '')), 120);
  external_id := nullif(btrim(coalesce(p_row ->> 'external_id', '')), '');
  if occurred_on is null or amount_cents is null then
    reason := 'Data ou valor ausente';
  elsif occurred_on not between date '1990-01-01' and date '2100-12-31' then
    reason := 'Data fora do intervalo aceito';
  elsif occurred_on < p_account.initial_balance_date then
    reason := 'Data anterior ao saldo inicial da conta';
  elsif amount_cents = 0 or abs(amount_cents) > 999999999999 then
    reason := 'Valor zero ou fora do limite';
  elsif description = '' then
    reason := 'Descrição ausente';
  elsif external_id is null or char_length(external_id) > 200 then
    reason := 'Identificador ausente ou longo demais';
  end if;
end;
$$;
revoke all on function app_private.parse_import_row(jsonb, public.accounts) from public;

-- Pré-visualização: não grava nada. Devolve a situação de cada linha.
create function public.preview_import(p_account_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.accounts;
  v_result  jsonb := '[]'::jsonb;
  v_row     jsonb;
  v_idx     integer := 0;
  v_parsed  record;
  v_status  text;
begin
  perform app_private.require_user();
  if p_account_id is null or not app_private.can_write_account(p_account_id) then
    raise exception 'Sem permissão para lançar nesta conta' using errcode = 'insufficient_privilege';
  end if;
  select * into v_account from public.accounts a where a.id = p_account_id;
  if v_account.kind = 'credit_card' then
    raise exception 'Importação disponível apenas para contas comuns' using errcode = 'check_violation';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Envie até 5.000 linhas' using errcode = 'invalid_parameter_value';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_parsed := app_private.parse_import_row(v_row, v_account);
    if v_parsed.reason is not null then
      v_status := 'invalid';
    elsif exists (select 1 from public.transactions t
                  where t.account_id = p_account_id and t.external_id = v_parsed.external_id) then
      v_status := 'duplicate';
    elsif exists (select 1 from public.transactions t
                  where t.account_id = p_account_id and t.status <> 'cancelled'
                    and t.occurred_on = v_parsed.occurred_on and t.amount_cents = abs(v_parsed.amount_cents)
                    and t.kind = case when v_parsed.amount_cents > 0 then 'income'::public.entry_kind else 'expense' end
                    and t.external_id is null) then
      v_status := 'possible_duplicate';
    else
      v_status := 'new';
    end if;
    v_result := v_result || jsonb_build_object('index', v_idx, 'status', v_status, 'reason', v_parsed.reason);
    v_idx := v_idx + 1;
  end loop;
  return v_result;
end;
$$;

create function public.import_entries(
  p_account_id uuid,
  p_rows jsonb,
  p_source text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := app_private.require_user();
  v_account    public.accounts := app_private.lock_writable_account(p_account_id);
  v_existing   uuid;
  v_batch      public.import_batches;
  v_row        jsonb;
  v_idx        integer := 0;
  v_parsed     record;
  v_imported   integer := 0;
  v_duplicates integer := 0;
  v_rejected   jsonb := '[]'::jsonb;
  v_id         uuid;
begin
  if v_account.kind = 'credit_card' then
    raise exception 'Importação disponível apenas para contas comuns' using errcode = 'check_violation';
  end if;
  if p_source is null or p_source not in ('ofx', 'csv') then
    raise exception 'Formato de origem inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Envie até 5.000 linhas' using errcode = 'invalid_parameter_value';
  end if;

  v_existing := app_private.idem_begin('import_entries', p_idempotency_key,
    md5(format('%L|%L|%L', p_account_id, p_source, p_rows::text)));
  if v_existing is not null then
    select * into v_batch from public.import_batches b where b.id = v_existing;
    return jsonb_build_object('batch_id', v_batch.id, 'imported', v_batch.imported_rows,
      'duplicates', v_batch.duplicate_rows, 'rejected', v_batch.rejected_rows, 'rejected_rows', '[]'::jsonb,
      'replayed', true);
  end if;

  insert into public.import_batches (household_id, account_id, source, total_rows, imported_rows,
    duplicate_rows, rejected_rows, created_by)
  values (v_account.household_id, v_account.id, p_source, jsonb_array_length(p_rows), 0, 0, 0, v_user)
  returning * into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_parsed := app_private.parse_import_row(v_row, v_account);
    if v_parsed.reason is not null then
      v_rejected := v_rejected || jsonb_build_object('index', v_idx, 'reason', v_parsed.reason);
    else
      insert into public.transactions (household_id, account_id, kind, status, amount_cents, occurred_on,
        description, import_batch_id, external_id, created_by)
      values (v_account.household_id, v_account.id,
        case when v_parsed.amount_cents > 0 then 'income'::public.entry_kind else 'expense' end,
        'posted', abs(v_parsed.amount_cents), v_parsed.occurred_on, v_parsed.description,
        v_batch.id, v_parsed.external_id, v_user)
      on conflict (account_id, external_id) where external_id is not null do nothing
      returning id into v_id;
      if v_id is null then
        v_duplicates := v_duplicates + 1;
      else
        v_imported := v_imported + 1;
      end if;
      v_id := null;
    end if;
    v_idx := v_idx + 1;
  end loop;

  update public.import_batches b
  set imported_rows = v_imported, duplicate_rows = v_duplicates, rejected_rows = jsonb_array_length(v_rejected)
  where b.id = v_batch.id;

  perform app_private.idem_finish('import_entries', p_idempotency_key, v_batch.id);
  perform app_private.audit(v_account.household_id, 'import.completed', v_batch.id,
    jsonb_build_object('source', p_source, 'imported', v_imported, 'duplicates', v_duplicates,
      'rejected', jsonb_array_length(v_rejected)));

  return jsonb_build_object('batch_id', v_batch.id, 'imported', v_imported, 'duplicates', v_duplicates,
    'rejected', jsonb_array_length(v_rejected), 'rejected_rows', v_rejected, 'replayed', false);
end;
$$;

revoke all on function public.monthly_summary(uuid, date) from public, anon;
revoke all on function public.preview_import(uuid, jsonb) from public, anon;
revoke all on function public.import_entries(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.monthly_summary(uuid, date) to authenticated;
grant execute on function public.preview_import(uuid, jsonb) to authenticated;
grant execute on function public.import_entries(uuid, jsonb, text, uuid) to authenticated;
