-- =============================================================================
-- Migração 0005 — Núcleo financeiro: contas, compartilhamento, categorias,
-- lançamentos, transferências, edição, cancelamento e saldos
-- -----------------------------------------------------------------------------
-- Regras de acesso (D04, D05, D14):
--   * Toda conta pertence a um espaço e tem um titular (quem a criou).
--   * Ver ou lançar numa conta exige DUAS coisas: vínculo com o espaço e
--     concessão explícita na conta (`account_grants`). O papel é o teto:
--     `viewer` só lê, mesmo com concessão de escrita; owner/admin do espaço
--     NÃO veem contas que não foram compartilhadas com eles.
--   * Só o titular concede e revoga. Sair ou ser removido do espaço apaga as
--     concessões daquela pessoa nas contas do espaço.
--   * Categorias são do espaço (não são dados financeiros): todos os membros
--     veem; member ou superior cria e altera.
-- Regras de integridade:
--   * Saldos NÃO são armazenados: são derivados dos lançamentos (view
--     `account_balances`), sem risco de divergência.
--   * Lançamentos nunca são apagados nem editados no lugar: editar cancela o
--     original e cria um novo ligado por `replaces_id`; cancelar marca
--     `cancelled`. Tudo vai para a auditoria (sem valores nos metadados).
--   * Transferência = duas pernas (saída e entrada) com o mesmo
--     `transfer_id`, criadas e canceladas juntas; não contam como receita
--     nem despesa.
--   * Escrita só por RPC transacional com chave de idempotência.
-- =============================================================================

create type public.account_kind as enum ('checking', 'savings', 'cash', 'credit_card');
create type public.grant_access as enum ('read', 'write');
create type public.category_kind as enum ('income', 'expense');
create type public.entry_kind as enum (
  'income', 'expense',
  'transfer_out', 'transfer_in',
  'card_charge', 'card_payment_out', 'card_payment_in'
);
create type public.entry_status as enum ('pending', 'posted', 'cancelled');

-- Valor máximo aceito por lançamento: R$ 9.999.999.999,99 (cabe com folga no
-- inteiro seguro do JavaScript).
create function app_private.max_entry_cents()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 999999999999::bigint $$;

-- -----------------------------------------------------------------------------
-- Idempotência reutilizável (mesmo padrão de create_household)
-- -----------------------------------------------------------------------------
-- Retorna o recurso já criado quando a chave é repetida com os mesmos
-- parâmetros; retorna null quando esta chamada é a dona da chave.
create function app_private.idem_begin(p_operation text, p_key uuid, p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_existing app_private.idempotency_keys;
begin
  if p_key is null then
    raise exception 'Chave de idempotência obrigatória' using errcode = 'invalid_parameter_value';
  end if;

  insert into app_private.idempotency_keys (user_id, operation, key, request_hash)
  values (v_user, p_operation, p_key, p_hash)
  on conflict do nothing;
  if found then
    return null;
  end if;

  select * into v_existing
  from app_private.idempotency_keys k
  where k.user_id = v_user and k.operation = p_operation and k.key = p_key;

  if v_existing.request_hash <> p_hash then
    raise exception 'Chave de idempotência reutilizada com parâmetros diferentes'
      using errcode = 'unique_violation';
  end if;
  return v_existing.resource_id;
end;
$$;

create function app_private.idem_finish(p_operation text, p_key uuid, p_resource_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update app_private.idempotency_keys k
  set resource_id = p_resource_id
  where k.user_id = (select auth.uid()) and k.operation = p_operation and k.key = p_key;
$$;

revoke all on function app_private.idem_begin(text, uuid, text) from public;
revoke all on function app_private.idem_finish(text, uuid, uuid) from public;
revoke all on function app_private.max_entry_cents() from public;

-- Data de hoje no fuso do espaço (nunca o fuso do navegador).
create function app_private.household_today(p_household_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select h.timezone from public.households h where h.id = p_household_id),
    'America/Sao_Paulo'))::date;
$$;
revoke all on function app_private.household_today(uuid) from public;
grant execute on function app_private.household_today(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Contas
-- -----------------------------------------------------------------------------
create table public.accounts (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id) on delete restrict,
  owner_user_id          uuid not null references public.profiles (id) on delete restrict,
  name                   text not null check (char_length(btrim(name)) between 1 and 60),
  kind                   public.account_kind not null,
  initial_balance_cents  public.money_cents not null default 0,
  initial_balance_date   date not null,
  credit_limit_cents     public.money_cents check (credit_limit_cents >= 0),
  closing_day            smallint check (closing_day between 1 and 28),
  due_day                smallint check (due_day between 1 and 28),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1,
  check (
    (kind = 'credit_card'
      and credit_limit_cents is not null and closing_day is not null and due_day is not null
      and initial_balance_cents = 0)
    or
    (kind <> 'credit_card'
      and credit_limit_cents is null and closing_day is null and due_day is null)
  ),
  check (abs(initial_balance_cents) <= 999999999999)
);
create unique index accounts_household_name_uq on public.accounts (household_id, lower(btrim(name)));
create index accounts_household_idx on public.accounts (household_id);

create trigger accounts_touch
  before update on public.accounts
  for each row execute function app_private.touch_row();

create table public.account_grants (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  access      public.grant_access not null,
  granted_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index account_grants_user_idx on public.account_grants (user_id);

-- Acesso efetivo do usuário logado: concessão explícita limitada pelo papel.
create function app_private.account_access(p_account_id uuid)
returns public.grant_access
language sql
stable
security definer
set search_path = ''
as $$
  select case when m.role = 'viewer' then 'read'::public.grant_access else g.access end
  from public.accounts a
  join public.household_members m
    on m.household_id = a.household_id and m.user_id = (select auth.uid())
  join public.account_grants g
    on g.account_id = a.id and g.user_id = m.user_id
  where a.id = p_account_id;
$$;

create function app_private.can_read_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app_private.account_access(p_account_id) is not null $$;

create function app_private.can_write_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(app_private.account_access(p_account_id) = 'write', false) $$;

revoke all on function app_private.account_access(uuid) from public;
revoke all on function app_private.can_read_account(uuid) from public;
revoke all on function app_private.can_write_account(uuid) from public;
grant execute on function app_private.account_access(uuid) to authenticated;
grant execute on function app_private.can_read_account(uuid) to authenticated;
grant execute on function app_private.can_write_account(uuid) to authenticated;

-- Quem sai ou é removido do espaço perde as concessões nas contas do espaço.
create function app_private.drop_grants_on_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.account_grants g
  using public.accounts a
  where g.account_id = a.id
    and a.household_id = old.household_id
    and g.user_id = old.user_id;
  return old;
end;
$$;
revoke all on function app_private.drop_grants_on_member_removal() from public;

create trigger household_members_drop_grants
  after delete on public.household_members
  for each row execute function app_private.drop_grants_on_member_removal();

-- -----------------------------------------------------------------------------
-- Categorias
-- -----------------------------------------------------------------------------
create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 40),
  kind          public.category_kind not null,
  is_default    boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);
create unique index categories_household_kind_name_uq
  on public.categories (household_id, kind, lower(btrim(name)));

create trigger categories_touch
  before update on public.categories
  for each row execute function app_private.touch_row();

-- Categorias padrão. Idempotente: pode ser chamada quantas vezes for preciso.
create function app_private.seed_default_categories(p_household_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (household_id, name, kind, is_default)
  select p_household_id, d.name, d.kind::public.category_kind, true
  from (values
    ('Moradia', 'expense'), ('Mercado', 'expense'), ('Alimentação fora', 'expense'),
    ('Transporte', 'expense'), ('Saúde', 'expense'), ('Educação', 'expense'),
    ('Lazer', 'expense'), ('Vestuário', 'expense'), ('Contas e serviços', 'expense'),
    ('Assinaturas', 'expense'), ('Impostos e taxas', 'expense'), ('Presentes', 'expense'),
    ('Pets', 'expense'), ('Outras despesas', 'expense'),
    ('Salário', 'income'), ('Renda extra', 'income'), ('Rendimentos', 'income'),
    ('Reembolsos', 'income'), ('Outras receitas', 'income')
  ) as d(name, kind)
  on conflict (household_id, kind, lower(btrim(name))) do nothing;
$$;
revoke all on function app_private.seed_default_categories(uuid) from public;

create function app_private.seed_categories_on_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.seed_default_categories(new.id);
  return new;
end;
$$;
revoke all on function app_private.seed_categories_on_household() from public;

create trigger households_seed_categories
  after insert on public.households
  for each row execute function app_private.seed_categories_on_household();

-- Espaços criados antes desta migração (nenhum em ambiente compartilhado).
do $$
begin
  perform app_private.seed_default_categories(h.id) from public.households h;
end;
$$;

-- -----------------------------------------------------------------------------
-- Compras no cartão (cabeçalho das parcelas; regras na migração 0006)
-- -----------------------------------------------------------------------------
create table public.card_purchases (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete restrict,
  card_account_id    uuid not null references public.accounts (id) on delete restrict,
  description        text not null check (char_length(btrim(description)) between 1 and 120),
  total_cents        public.money_cents not null check (total_cents > 0 and total_cents <= 999999999999),
  installment_count  smallint not null check (installment_count between 1 and 48),
  purchased_on       date not null,
  category_id        uuid references public.categories (id) on delete restrict,
  attributed_to      uuid references public.profiles (id) on delete set null,
  status             text not null default 'active' check (status in ('active', 'cancelled')),
  created_by         uuid not null references public.profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  cancelled_by       uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now(),
  version            integer not null default 1
);
create index card_purchases_card_idx on public.card_purchases (card_account_id, purchased_on desc);

create trigger card_purchases_touch
  before update on public.card_purchases
  for each row execute function app_private.touch_row();

-- -----------------------------------------------------------------------------
-- Importações (registro do lote; regras na migração 0007)
-- -----------------------------------------------------------------------------
create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete restrict,
  account_id       uuid not null references public.accounts (id) on delete restrict,
  source           text not null check (source in ('ofx', 'csv')),
  total_rows       integer not null check (total_rows >= 0),
  imported_rows    integer not null check (imported_rows >= 0),
  duplicate_rows   integer not null check (duplicate_rows >= 0),
  rejected_rows    integer not null check (rejected_rows >= 0),
  created_by       uuid not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now()
);
create index import_batches_account_idx on public.import_batches (account_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Lançamentos
-- -----------------------------------------------------------------------------
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete restrict,
  account_id          uuid not null references public.accounts (id) on delete restrict,
  kind                public.entry_kind not null,
  status              public.entry_status not null default 'posted',
  amount_cents        public.money_cents not null check (amount_cents > 0 and amount_cents <= 999999999999),
  occurred_on         date not null check (occurred_on between date '1990-01-01' and date '2100-12-31'),
  description         text not null check (char_length(btrim(description)) between 1 and 120),
  category_id         uuid references public.categories (id) on delete restrict,
  attributed_to       uuid references public.profiles (id) on delete set null,
  transfer_id         uuid,
  purchase_id         uuid references public.card_purchases (id) on delete restrict,
  installment_number  smallint,
  installment_count   smallint,
  statement_month     date,
  replaces_id         uuid references public.transactions (id) on delete restrict,
  import_batch_id     uuid references public.import_batches (id) on delete restrict,
  external_id         text check (external_id is null or char_length(external_id) between 1 and 200),
  created_by          uuid not null references public.profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,
  -- Categoria só em receita, despesa e compra no cartão.
  check (category_id is null or kind in ('income', 'expense', 'card_charge')),
  -- Pendente só para receita/despesa (contas a pagar e a receber).
  check (status <> 'pending' or kind in ('income', 'expense')),
  -- Pernas de transferência/pagamento sempre ligadas.
  check ((transfer_id is not null) = (kind in ('transfer_out', 'transfer_in', 'card_payment_out', 'card_payment_in'))),
  -- Mês da fatura em compras e pagamentos de cartão.
  check ((statement_month is not null) = (kind in ('card_charge', 'card_payment_out', 'card_payment_in'))),
  check (statement_month is null or extract(day from statement_month) = 1),
  -- Parcelas só em compras no cartão.
  check ((purchase_id is not null) = (kind = 'card_charge')),
  check (
    (purchase_id is null and installment_number is null and installment_count is null)
    or (installment_number between 1 and installment_count and installment_count between 1 and 48)
  ),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index transactions_household_date_idx on public.transactions (household_id, occurred_on desc);
create index transactions_account_idx on public.transactions (account_id, occurred_on);
create index transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;
create index transactions_purchase_idx on public.transactions (purchase_id) where purchase_id is not null;
create index transactions_statement_idx on public.transactions (account_id, statement_month) where statement_month is not null;
-- Deduplicação de importações: um identificador externo por conta, em
-- qualquer situação (inclusive cancelado), para que reimportar não recrie.
create unique index transactions_account_external_uq
  on public.transactions (account_id, external_id) where external_id is not null;

create trigger transactions_touch
  before update on public.transactions
  for each row execute function app_private.touch_row();

-- Coerência entre conta, espaço, tipo e categoria (vale também para RPCs).
create function app_private.check_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account  public.accounts;
  v_category public.categories;
begin
  select * into v_account from public.accounts a where a.id = new.account_id;
  if v_account.household_id <> new.household_id then
    raise exception 'Lançamento e conta pertencem a espaços diferentes' using errcode = 'check_violation';
  end if;
  if (v_account.kind = 'credit_card') <> (new.kind in ('card_charge', 'card_payment_in')) then
    raise exception 'Tipo de lançamento incompatível com a conta' using errcode = 'check_violation';
  end if;
  if new.category_id is not null then
    select * into v_category from public.categories c where c.id = new.category_id;
    if v_category.household_id <> new.household_id
       or v_category.kind::text <> (case when new.kind = 'income' then 'income' else 'expense' end) then
      raise exception 'Categoria incompatível com o lançamento' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.check_transaction() from public;

create trigger transactions_check
  before insert or update on public.transactions
  for each row execute function app_private.check_transaction();

-- -----------------------------------------------------------------------------
-- Privilégios e RLS (somente leitura direta; escrita apenas por RPC)
-- -----------------------------------------------------------------------------
revoke all on public.accounts, public.account_grants, public.categories, public.card_purchases,
  public.import_batches, public.transactions
  from public, anon, authenticated;

grant select on public.accounts, public.account_grants, public.categories, public.card_purchases,
  public.import_batches, public.transactions
  to authenticated;

alter table public.accounts enable row level security;
alter table public.account_grants enable row level security;
alter table public.categories enable row level security;
alter table public.card_purchases enable row level security;
alter table public.import_batches enable row level security;
alter table public.transactions enable row level security;

create policy accounts_select_granted on public.accounts
  for select to authenticated
  using (app_private.can_read_account(id));

-- Quem pode ler a conta vê com quem ela está compartilhada.
create policy account_grants_select_granted on public.account_grants
  for select to authenticated
  using (app_private.can_read_account(account_id));

create policy categories_select_member on public.categories
  for select to authenticated
  using (app_private.has_household_role(household_id, 'viewer'));

create policy card_purchases_select_granted on public.card_purchases
  for select to authenticated
  using (app_private.can_read_account(card_account_id));

create policy import_batches_select_granted on public.import_batches
  for select to authenticated
  using (app_private.can_read_account(account_id));

create policy transactions_select_granted on public.transactions
  for select to authenticated
  using (app_private.can_read_account(account_id));

-- -----------------------------------------------------------------------------
-- Saldos derivados (security_invoker: o RLS do chamador se aplica)
-- -----------------------------------------------------------------------------
-- Contas comuns: saldo = inicial + entradas − saídas efetivadas.
-- Cartão: saldo = −(compras − pagamentos) = dívida; disponível = limite − dívida.
create view public.account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.household_id,
  a.kind,
  (a.initial_balance_cents
    + coalesce(sum(t.amount_cents) filter (
        where t.status = 'posted' and t.kind in ('income', 'transfer_in', 'card_payment_in')), 0)
    - coalesce(sum(t.amount_cents) filter (
        where t.status = 'posted' and t.kind in ('expense', 'transfer_out', 'card_payment_out', 'card_charge')), 0)
  )::bigint as balance_cents,
  coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'income'), 0)::bigint
    as pending_income_cents,
  coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'expense'), 0)::bigint
    as pending_expense_cents,
  case when a.kind = 'credit_card' then
    (a.credit_limit_cents
      - coalesce(sum(t.amount_cents) filter (where t.status = 'posted' and t.kind = 'card_charge'), 0)
      + coalesce(sum(t.amount_cents) filter (where t.status = 'posted' and t.kind = 'card_payment_in'), 0)
    )::bigint
  end as available_credit_cents
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

revoke all on public.account_balances from public, anon, authenticated;
grant select on public.account_balances to authenticated;

-- -----------------------------------------------------------------------------
-- Validações compartilhadas pelas RPCs
-- -----------------------------------------------------------------------------
create function app_private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;
  return v_user;
end;
$$;
revoke all on function app_private.require_user() from public;

-- Carrega a conta para escrita, com bloqueio, exigindo concessão de escrita.
-- Recusa genérica: não revela se a conta existe.
create function app_private.lock_writable_account(p_account_id uuid, p_require_active boolean default true)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.accounts;
begin
  if p_account_id is null or not app_private.can_write_account(p_account_id) then
    raise exception 'Sem permissão para lançar nesta conta' using errcode = 'insufficient_privilege';
  end if;
  select * into v_account from public.accounts a where a.id = p_account_id for update;
  if p_require_active and not v_account.is_active then
    raise exception 'Conta desativada' using errcode = 'check_violation';
  end if;
  return v_account;
end;
$$;
revoke all on function app_private.lock_writable_account(uuid, boolean) from public;

create function app_private.validate_entry_fields(
  p_account public.accounts,
  p_amount_cents bigint,
  p_occurred_on date,
  p_description text,
  p_category_id uuid,
  p_category_kind public.category_kind,
  p_attributed_to uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_description text := btrim(coalesce(p_description, ''));
  v_category    public.categories;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > app_private.max_entry_cents() then
    raise exception 'Valor deve ser maior que zero' using errcode = 'check_violation';
  end if;
  if p_occurred_on is null then
    raise exception 'Data obrigatória' using errcode = 'invalid_parameter_value';
  end if;
  if p_account.kind <> 'credit_card' and p_occurred_on < p_account.initial_balance_date then
    raise exception 'Data anterior à data do saldo inicial da conta' using errcode = 'check_violation';
  end if;
  if char_length(v_description) not between 1 and 120 then
    raise exception 'Descrição deve ter entre 1 e 120 caracteres' using errcode = 'check_violation';
  end if;
  if p_category_id is not null then
    select * into v_category from public.categories c where c.id = p_category_id;
    if v_category.id is null or v_category.household_id <> p_account.household_id
       or v_category.kind <> p_category_kind or not v_category.is_active then
      raise exception 'Categoria inválida para este lançamento' using errcode = 'check_violation';
    end if;
  end if;
  if p_attributed_to is not null and not exists (
    select 1 from public.household_members m
    where m.household_id = p_account.household_id and m.user_id = p_attributed_to
  ) then
    raise exception 'Responsável deve ser membro do espaço' using errcode = 'check_violation';
  end if;
  return v_description;
end;
$$;
revoke all on function app_private.validate_entry_fields(public.accounts, bigint, date, text, uuid, public.category_kind, uuid) from public;

create function app_private.audit(p_household_id uuid, p_action text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app_private.audit_events (actor_id, household_id, action, entity_id, metadata)
  values ((select auth.uid()), p_household_id, p_action, p_entity_id, p_metadata);
$$;
revoke all on function app_private.audit(uuid, text, uuid, jsonb) from public;

-- -----------------------------------------------------------------------------
-- RPCs de contas
-- -----------------------------------------------------------------------------
create function public.create_account(
  p_household_id uuid,
  p_name text,
  p_kind public.account_kind,
  p_idempotency_key uuid,
  p_initial_balance_cents bigint default 0,
  p_initial_balance_date date default null,
  p_credit_limit_cents bigint default null,
  p_closing_day smallint default null,
  p_due_day smallint default null,
  p_share_with uuid[] default '{}',
  p_share_access public.grant_access default 'write'
)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := app_private.require_user();
  v_name     text := btrim(coalesce(p_name, ''));
  v_share    uuid[] := coalesce(p_share_with, '{}');
  v_date     date;
  v_existing uuid;
  v_account  public.accounts;
  v_target   uuid;
begin
  if not app_private.has_household_role(p_household_id, 'member') then
    raise exception 'Sem permissão para criar contas neste espaço' using errcode = 'insufficient_privilege';
  end if;
  v_date := coalesce(p_initial_balance_date, app_private.household_today(p_household_id));

  v_existing := app_private.idem_begin('create_account', p_idempotency_key, md5(format(
    '%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L', p_household_id, v_name, p_kind, p_initial_balance_cents,
    v_date, p_credit_limit_cents, p_closing_day, p_due_day, v_share, p_share_access, 'v1')));
  if v_existing is not null then
    select * into v_account from public.accounts a where a.id = v_existing;
    return v_account;
  end if;

  if char_length(v_name) not between 1 and 60 then
    raise exception 'Nome da conta deve ter entre 1 e 60 caracteres' using errcode = 'check_violation';
  end if;
  if p_kind is null then
    raise exception 'Tipo de conta obrigatório' using errcode = 'invalid_parameter_value';
  end if;
  if abs(coalesce(p_initial_balance_cents, 0)) > app_private.max_entry_cents() then
    raise exception 'Saldo inicial fora do limite' using errcode = 'check_violation';
  end if;
  if p_share_access is null then
    raise exception 'Tipo de acesso obrigatório' using errcode = 'invalid_parameter_value';
  end if;

  foreach v_target in array v_share loop
    if v_target = v_user or not exists (
      select 1 from public.household_members m
      where m.household_id = p_household_id and m.user_id = v_target
    ) then
      raise exception 'Só é possível compartilhar com outros membros do espaço' using errcode = 'check_violation';
    end if;
  end loop;

  insert into public.accounts (
    household_id, owner_user_id, name, kind, initial_balance_cents, initial_balance_date,
    credit_limit_cents, closing_day, due_day
  ) values (
    p_household_id, v_user, v_name, p_kind,
    case when p_kind = 'credit_card' then 0 else coalesce(p_initial_balance_cents, 0) end,
    v_date,
    case when p_kind = 'credit_card' then p_credit_limit_cents end,
    case when p_kind = 'credit_card' then p_closing_day end,
    case when p_kind = 'credit_card' then p_due_day end
  )
  returning * into v_account;

  insert into public.account_grants (account_id, user_id, access, granted_by)
  values (v_account.id, v_user, 'write', v_user);

  insert into public.account_grants (account_id, user_id, access, granted_by)
  select distinct v_account.id, s, p_share_access, v_user from unnest(v_share) s;

  perform app_private.idem_finish('create_account', p_idempotency_key, v_account.id);
  perform app_private.audit(p_household_id, 'account.created', v_account.id,
    jsonb_build_object('kind', p_kind, 'shared_with', cardinality(v_share)));
  return v_account;
end;
$$;

create function public.update_account(
  p_account_id uuid,
  p_expected_version integer,
  p_name text,
  p_initial_balance_cents bigint default null,
  p_initial_balance_date date default null,
  p_credit_limit_cents bigint default null,
  p_closing_day smallint default null,
  p_due_day smallint default null
)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := app_private.require_user();
  v_account public.accounts := app_private.lock_writable_account(p_account_id, false);
  v_name    text := btrim(coalesce(p_name, ''));
  v_initial bigint;
  v_date    date;
begin
  if v_account.owner_user_id <> v_user then
    raise exception 'Só o titular pode alterar esta conta' using errcode = 'insufficient_privilege';
  end if;
  if v_account.version <> p_expected_version then
    raise exception 'A conta foi alterada por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Nome da conta deve ter entre 1 e 60 caracteres' using errcode = 'check_violation';
  end if;

  if v_account.kind = 'credit_card' then
    update public.accounts a set
      name = v_name,
      credit_limit_cents = coalesce(p_credit_limit_cents, a.credit_limit_cents),
      closing_day = coalesce(p_closing_day, a.closing_day),
      due_day = coalesce(p_due_day, a.due_day)
    where a.id = p_account_id
    returning * into v_account;
  else
    v_initial := coalesce(p_initial_balance_cents, v_account.initial_balance_cents);
    v_date := coalesce(p_initial_balance_date, v_account.initial_balance_date);
    if abs(v_initial) > app_private.max_entry_cents() then
      raise exception 'Saldo inicial fora do limite' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.transactions t
      where t.account_id = p_account_id and t.status <> 'cancelled' and t.occurred_on < v_date
    ) then
      raise exception 'Há lançamentos anteriores à nova data do saldo inicial' using errcode = 'check_violation';
    end if;
    update public.accounts a set
      name = v_name,
      initial_balance_cents = v_initial,
      initial_balance_date = v_date
    where a.id = p_account_id
    returning * into v_account;
  end if;

  perform app_private.audit(v_account.household_id, 'account.updated', v_account.id);
  return v_account;
end;
$$;

-- Desativar não apaga histórico: a conta some dos formulários e não aceita
-- novos lançamentos; saldo e lançamentos continuam consultáveis.
create function public.set_account_active(p_account_id uuid, p_expected_version integer, p_active boolean)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := app_private.require_user();
  v_account public.accounts := app_private.lock_writable_account(p_account_id, false);
begin
  if v_account.owner_user_id <> v_user then
    raise exception 'Só o titular pode alterar esta conta' using errcode = 'insufficient_privilege';
  end if;
  if v_account.version <> p_expected_version then
    raise exception 'A conta foi alterada por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;
  if p_active is null then
    raise exception 'Situação obrigatória' using errcode = 'invalid_parameter_value';
  end if;
  update public.accounts a set is_active = p_active where a.id = p_account_id returning * into v_account;
  perform app_private.audit(v_account.household_id,
    case when p_active then 'account.reactivated' else 'account.deactivated' end, v_account.id);
  return v_account;
end;
$$;

-- Concessão e revogação: somente o titular da conta.
create function public.grant_account_access(p_account_id uuid, p_user_id uuid, p_access public.grant_access)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := app_private.require_user();
  v_account public.accounts;
begin
  select * into v_account from public.accounts a where a.id = p_account_id for update;
  if v_account.id is null or v_account.owner_user_id <> v_user
     or not app_private.can_read_account(p_account_id) then
    raise exception 'Só o titular pode compartilhar esta conta' using errcode = 'insufficient_privilege';
  end if;
  if p_access is null or p_user_id is null or p_user_id = v_user or not exists (
    select 1 from public.household_members m
    where m.household_id = v_account.household_id and m.user_id = p_user_id
  ) then
    raise exception 'Só é possível compartilhar com outros membros do espaço' using errcode = 'check_violation';
  end if;

  insert into public.account_grants (account_id, user_id, access, granted_by)
  values (p_account_id, p_user_id, p_access, v_user)
  on conflict (account_id, user_id) do update set access = excluded.access, granted_by = excluded.granted_by;

  perform app_private.audit(v_account.household_id, 'account.shared', p_account_id,
    jsonb_build_object('access', p_access));
end;
$$;

create function public.revoke_account_access(p_account_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := app_private.require_user();
  v_account public.accounts;
begin
  select * into v_account from public.accounts a where a.id = p_account_id for update;
  if v_account.id is null or v_account.owner_user_id <> v_user
     or not app_private.can_read_account(p_account_id) then
    raise exception 'Só o titular pode alterar o compartilhamento' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null or p_user_id = v_user then
    raise exception 'O titular não pode remover o próprio acesso' using errcode = 'check_violation';
  end if;

  delete from public.account_grants g where g.account_id = p_account_id and g.user_id = p_user_id;
  if found then
    perform app_private.audit(v_account.household_id, 'account.unshared', p_account_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs de categorias
-- -----------------------------------------------------------------------------
create function public.ensure_default_categories(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_user();
  if not app_private.has_household_role(p_household_id, 'member') then
    raise exception 'Sem permissão neste espaço' using errcode = 'insufficient_privilege';
  end if;
  perform app_private.seed_default_categories(p_household_id);
end;
$$;

create function public.create_category(
  p_household_id uuid,
  p_name text,
  p_kind public.category_kind,
  p_idempotency_key uuid
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := app_private.require_user();
  v_name     text := btrim(coalesce(p_name, ''));
  v_existing uuid;
  v_category public.categories;
begin
  if not app_private.has_household_role(p_household_id, 'member') then
    raise exception 'Sem permissão neste espaço' using errcode = 'insufficient_privilege';
  end if;
  v_existing := app_private.idem_begin('create_category', p_idempotency_key,
    md5(format('%L|%L|%L', p_household_id, v_name, p_kind)));
  if v_existing is not null then
    select * into v_category from public.categories c where c.id = v_existing;
    return v_category;
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Nome da categoria deve ter entre 1 e 40 caracteres' using errcode = 'check_violation';
  end if;
  if p_kind is null then
    raise exception 'Tipo da categoria obrigatório' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.categories (household_id, name, kind)
  values (p_household_id, v_name, p_kind)
  returning * into v_category;

  perform app_private.idem_finish('create_category', p_idempotency_key, v_category.id);
  perform app_private.audit(p_household_id, 'category.created', v_category.id, jsonb_build_object('kind', p_kind));
  return v_category;
end;
$$;

-- Renomear vale para o histórico (o lançamento guarda a referência, não o nome).
create function public.update_category(
  p_category_id uuid,
  p_expected_version integer,
  p_name text,
  p_active boolean
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := app_private.require_user();
  v_name     text := btrim(coalesce(p_name, ''));
  v_category public.categories;
begin
  select * into v_category from public.categories c where c.id = p_category_id for update;
  if v_category.id is null or not app_private.has_household_role(v_category.household_id, 'member') then
    raise exception 'Sem permissão neste espaço' using errcode = 'insufficient_privilege';
  end if;
  if v_category.version <> p_expected_version then
    raise exception 'A categoria foi alterada por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Nome da categoria deve ter entre 1 e 40 caracteres' using errcode = 'check_violation';
  end if;

  update public.categories c
  set name = v_name, is_active = coalesce(p_active, c.is_active)
  where c.id = p_category_id
  returning * into v_category;

  perform app_private.audit(v_category.household_id, 'category.updated', v_category.id);
  return v_category;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs de lançamentos
-- -----------------------------------------------------------------------------
create function public.create_entry(
  p_account_id uuid,
  p_kind public.entry_kind,
  p_amount_cents bigint,
  p_occurred_on date,
  p_description text,
  p_idempotency_key uuid,
  p_category_id uuid default null,
  p_attributed_to uuid default null,
  p_status public.entry_status default 'posted'
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := app_private.require_user();
  v_account     public.accounts := app_private.lock_writable_account(p_account_id);
  v_description text;
  v_existing    uuid;
  v_entry       public.transactions;
begin
  v_existing := app_private.idem_begin('create_entry', p_idempotency_key, md5(format(
    '%L|%L|%L|%L|%L|%L|%L|%L', p_account_id, p_kind, p_amount_cents, p_occurred_on,
    btrim(coalesce(p_description, '')), p_category_id, p_attributed_to, p_status)));
  if v_existing is not null then
    select * into v_entry from public.transactions t where t.id = v_existing;
    return v_entry;
  end if;

  if p_kind is null or p_kind not in ('income', 'expense') then
    raise exception 'Use receita ou despesa' using errcode = 'invalid_parameter_value';
  end if;
  if v_account.kind = 'credit_card' then
    raise exception 'Use compra no cartão para lançar no cartão' using errcode = 'check_violation';
  end if;
  if p_status is null or p_status not in ('pending', 'posted') then
    raise exception 'Situação inválida' using errcode = 'invalid_parameter_value';
  end if;
  v_description := app_private.validate_entry_fields(v_account, p_amount_cents, p_occurred_on, p_description,
    p_category_id, case when p_kind = 'income' then 'income'::public.category_kind else 'expense' end, p_attributed_to);

  insert into public.transactions (
    household_id, account_id, kind, status, amount_cents, occurred_on, description,
    category_id, attributed_to, created_by
  ) values (
    v_account.household_id, v_account.id, p_kind, p_status, p_amount_cents, p_occurred_on, v_description,
    p_category_id, p_attributed_to, v_user
  ) returning * into v_entry;

  perform app_private.idem_finish('create_entry', p_idempotency_key, v_entry.id);
  perform app_private.audit(v_account.household_id, 'entry.created', v_entry.id,
    jsonb_build_object('kind', p_kind, 'status', p_status));
  return v_entry;
end;
$$;

-- Edição sem apagar histórico: cancela o original e cria o substituto.
-- Mantém conta, tipo e situação; muda valor, data, descrição, categoria e responsável.
create function public.update_entry(
  p_entry_id uuid,
  p_expected_version integer,
  p_amount_cents bigint,
  p_occurred_on date,
  p_description text,
  p_idempotency_key uuid,
  p_category_id uuid default null,
  p_attributed_to uuid default null
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := app_private.require_user();
  v_old         public.transactions;
  v_account     public.accounts;
  v_description text;
  v_existing    uuid;
  v_entry       public.transactions;
begin
  v_existing := app_private.idem_begin('update_entry', p_idempotency_key, md5(format(
    '%L|%L|%L|%L|%L|%L|%L', p_entry_id, p_expected_version, p_amount_cents, p_occurred_on,
    btrim(coalesce(p_description, '')), p_category_id, p_attributed_to)));
  if v_existing is not null then
    select * into v_entry from public.transactions t where t.id = v_existing;
    return v_entry;
  end if;

  select * into v_old from public.transactions t where t.id = p_entry_id;
  if v_old.id is null then
    raise exception 'Sem permissão para lançar nesta conta' using errcode = 'insufficient_privilege';
  end if;
  v_account := app_private.lock_writable_account(v_old.account_id);
  select * into v_old from public.transactions t where t.id = p_entry_id for update;

  if v_old.kind not in ('income', 'expense') then
    raise exception 'Só receitas e despesas podem ser editadas; cancele e lance de novo' using errcode = 'check_violation';
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'Lançamento já cancelado' using errcode = 'check_violation';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'O lançamento foi alterado por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;
  v_description := app_private.validate_entry_fields(v_account, p_amount_cents, p_occurred_on, p_description,
    p_category_id, case when v_old.kind = 'income' then 'income'::public.category_kind else 'expense' end, p_attributed_to);

  update public.transactions t
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user
  where t.id = v_old.id;

  insert into public.transactions (
    household_id, account_id, kind, status, amount_cents, occurred_on, description,
    category_id, attributed_to, replaces_id, import_batch_id, created_by
  ) values (
    v_old.household_id, v_old.account_id, v_old.kind, v_old.status, p_amount_cents, p_occurred_on, v_description,
    p_category_id, p_attributed_to, v_old.id, v_old.import_batch_id, v_user
  ) returning * into v_entry;

  perform app_private.idem_finish('update_entry', p_idempotency_key, v_entry.id);
  perform app_private.audit(v_old.household_id, 'entry.replaced', v_entry.id,
    jsonb_build_object('replaces', v_old.id));
  return v_entry;
end;
$$;

-- Marca uma conta a pagar/receber como efetivada na data informada.
create function public.settle_entry(p_entry_id uuid, p_expected_version integer, p_paid_on date)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := app_private.require_user();
  v_entry   public.transactions;
  v_account public.accounts;
begin
  select * into v_entry from public.transactions t where t.id = p_entry_id;
  if v_entry.id is null then
    raise exception 'Sem permissão para lançar nesta conta' using errcode = 'insufficient_privilege';
  end if;
  v_account := app_private.lock_writable_account(v_entry.account_id);
  select * into v_entry from public.transactions t where t.id = p_entry_id for update;

  if v_entry.status <> 'pending' then
    raise exception 'Somente lançamentos pendentes podem ser efetivados' using errcode = 'check_violation';
  end if;
  if v_entry.version <> p_expected_version then
    raise exception 'O lançamento foi alterado por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;
  if p_paid_on is null or p_paid_on < v_account.initial_balance_date then
    raise exception 'Data inválida para efetivar' using errcode = 'check_violation';
  end if;

  update public.transactions t
  set status = 'posted', occurred_on = p_paid_on
  where t.id = p_entry_id
  returning * into v_entry;

  perform app_private.audit(v_entry.household_id, 'entry.settled', v_entry.id);
  return v_entry;
end;
$$;

-- Cancela (estorna) um lançamento. Transferências e pagamentos de fatura
-- cancelam as duas pernas; compras no cartão usam cancel_card_purchase.
create function public.cancel_entry(p_entry_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := app_private.require_user();
  v_entry public.transactions;
  v_leg   public.transactions;
begin
  select * into v_entry from public.transactions t where t.id = p_entry_id;
  if v_entry.id is null then
    raise exception 'Sem permissão para lançar nesta conta' using errcode = 'insufficient_privilege';
  end if;
  perform app_private.lock_writable_account(v_entry.account_id, false);

  if v_entry.kind = 'card_charge' then
    raise exception 'Cancele a compra inteira no cartão' using errcode = 'check_violation';
  end if;

  if v_entry.transfer_id is not null then
    for v_leg in
      select * from public.transactions t where t.transfer_id = v_entry.transfer_id and t.id <> v_entry.id
    loop
      perform app_private.lock_writable_account(v_leg.account_id, false);
    end loop;
  end if;

  select * into v_entry from public.transactions t where t.id = p_entry_id for update;
  if v_entry.status = 'cancelled' then
    raise exception 'Lançamento já cancelado' using errcode = 'check_violation';
  end if;
  if v_entry.version <> p_expected_version then
    raise exception 'O lançamento foi alterado por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;

  update public.transactions t
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user
  where (t.id = v_entry.id or (v_entry.transfer_id is not null and t.transfer_id = v_entry.transfer_id))
    and t.status <> 'cancelled';

  perform app_private.audit(v_entry.household_id, 'entry.cancelled', v_entry.id,
    jsonb_build_object('kind', v_entry.kind));
end;
$$;

-- Transferência entre contas comuns às quais o usuário tem acesso de escrita
-- (podem estar em espaços diferentes, ex.: conta pessoal → conta da família).
create function public.create_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_cents bigint,
  p_occurred_on date,
  p_description text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := app_private.require_user();
  v_from        public.accounts;
  v_to          public.accounts;
  v_description text;
  v_existing    uuid;
  v_transfer    uuid := gen_random_uuid();
  v_out_id      uuid;
begin
  v_existing := app_private.idem_begin('create_transfer', p_idempotency_key, md5(format(
    '%L|%L|%L|%L|%L', p_from_account_id, p_to_account_id, p_amount_cents, p_occurred_on,
    btrim(coalesce(p_description, '')))));
  if v_existing is not null then
    select t.transfer_id into v_transfer from public.transactions t where t.id = v_existing;
    return v_transfer;
  end if;

  if p_from_account_id is null or p_from_account_id = p_to_account_id then
    raise exception 'Escolha contas de origem e destino diferentes' using errcode = 'check_violation';
  end if;
  -- Bloqueio em ordem fixa evita impasse entre transferências opostas simultâneas.
  if p_from_account_id < p_to_account_id then
    v_from := app_private.lock_writable_account(p_from_account_id);
    v_to := app_private.lock_writable_account(p_to_account_id);
  else
    v_to := app_private.lock_writable_account(p_to_account_id);
    v_from := app_private.lock_writable_account(p_from_account_id);
  end if;
  if v_from.kind = 'credit_card' or v_to.kind = 'credit_card' then
    raise exception 'Para cartão use o pagamento de fatura' using errcode = 'check_violation';
  end if;
  v_description := app_private.validate_entry_fields(v_from, p_amount_cents, p_occurred_on, p_description,
    null, 'expense', null);
  perform app_private.validate_entry_fields(v_to, p_amount_cents, p_occurred_on, p_description,
    null, 'income', null);

  insert into public.transactions (household_id, account_id, kind, amount_cents, occurred_on, description, transfer_id, created_by)
  values (v_from.household_id, v_from.id, 'transfer_out', p_amount_cents, p_occurred_on, v_description, v_transfer, v_user)
  returning id into v_out_id;
  insert into public.transactions (household_id, account_id, kind, amount_cents, occurred_on, description, transfer_id, created_by)
  values (v_to.household_id, v_to.id, 'transfer_in', p_amount_cents, p_occurred_on, v_description, v_transfer, v_user);

  perform app_private.idem_finish('create_transfer', p_idempotency_key, v_out_id);
  perform app_private.audit(v_from.household_id, 'transfer.created', v_transfer);
  if v_to.household_id <> v_from.household_id then
    perform app_private.audit(v_to.household_id, 'transfer.created', v_transfer);
  end if;
  return v_transfer;
end;
$$;

-- Lançamentos de um espaço num intervalo (RLS do chamador se aplica).
create function public.list_entries(p_household_id uuid, p_from date, p_to date)
returns setof public.transactions
language sql
stable
security invoker
set search_path = ''
as $$
  select t.*
  from public.transactions t
  where t.household_id = p_household_id
    and t.occurred_on between p_from and p_to
  order by t.occurred_on desc, t.created_at desc
  limit 5000;
$$;

-- -----------------------------------------------------------------------------
-- Privilégios das funções
-- -----------------------------------------------------------------------------
revoke all on function public.create_account(uuid, text, public.account_kind, uuid, bigint, date, bigint, smallint, smallint, uuid[], public.grant_access) from public, anon;
revoke all on function public.update_account(uuid, integer, text, bigint, date, bigint, smallint, smallint) from public, anon;
revoke all on function public.set_account_active(uuid, integer, boolean) from public, anon;
revoke all on function public.grant_account_access(uuid, uuid, public.grant_access) from public, anon;
revoke all on function public.revoke_account_access(uuid, uuid) from public, anon;
revoke all on function public.ensure_default_categories(uuid) from public, anon;
revoke all on function public.create_category(uuid, text, public.category_kind, uuid) from public, anon;
revoke all on function public.update_category(uuid, integer, text, boolean) from public, anon;
revoke all on function public.create_entry(uuid, public.entry_kind, bigint, date, text, uuid, uuid, uuid, public.entry_status) from public, anon;
revoke all on function public.update_entry(uuid, integer, bigint, date, text, uuid, uuid, uuid) from public, anon;
revoke all on function public.settle_entry(uuid, integer, date) from public, anon;
revoke all on function public.cancel_entry(uuid, integer) from public, anon;
revoke all on function public.create_transfer(uuid, uuid, bigint, date, text, uuid) from public, anon;
revoke all on function public.list_entries(uuid, date, date) from public, anon;

grant execute on function public.create_account(uuid, text, public.account_kind, uuid, bigint, date, bigint, smallint, smallint, uuid[], public.grant_access) to authenticated;
grant execute on function public.update_account(uuid, integer, text, bigint, date, bigint, smallint, smallint) to authenticated;
grant execute on function public.set_account_active(uuid, integer, boolean) to authenticated;
grant execute on function public.grant_account_access(uuid, uuid, public.grant_access) to authenticated;
grant execute on function public.revoke_account_access(uuid, uuid) to authenticated;
grant execute on function public.ensure_default_categories(uuid) to authenticated;
grant execute on function public.create_category(uuid, text, public.category_kind, uuid) to authenticated;
grant execute on function public.update_category(uuid, integer, text, boolean) to authenticated;
grant execute on function public.create_entry(uuid, public.entry_kind, bigint, date, text, uuid, uuid, uuid, public.entry_status) to authenticated;
grant execute on function public.update_entry(uuid, integer, bigint, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.settle_entry(uuid, integer, date) to authenticated;
grant execute on function public.cancel_entry(uuid, integer) to authenticated;
grant execute on function public.create_transfer(uuid, uuid, bigint, date, text, uuid) to authenticated;
grant execute on function public.list_entries(uuid, date, date) to authenticated;
