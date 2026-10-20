-- =============================================================================
-- Migração 0002 — Perfis, grupos (households) e membros, com RLS
-- -----------------------------------------------------------------------------
-- Modelo de isolamento: todo dado financeiro futuro pertencerá a um
-- `household` (espaço). Um espaço `personal` representa as finanças
-- individuais (um único membro); um espaço `family` representa o grupo
-- familiar. O acesso é decidido no banco (RLS), nunca apenas no frontend.
--
-- Fora do escopo desta fase: convites, inclusão/remoção de membros,
-- exclusão de espaços.
-- =============================================================================

-- Ordem de declaração = ordem de privilégio (owner é o maior).
-- `role <= 'admin'` significa "admin ou superior".
create type public.household_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.household_kind as enum ('personal', 'family');

-- -----------------------------------------------------------------------------
-- Perfis (1:1 com auth.users, gerenciado pelo Supabase Auth)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  timezone      text not null default 'America/Sao_Paulo'
                check (app_private.is_valid_timezone(timezone)),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function app_private.touch_row();

-- Cria o perfil automaticamente quando um usuário é criado no Supabase Auth.
-- Não copia e-mail nem metadados para evitar duplicar dados pessoais.
create function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Espaços (households)
-- -----------------------------------------------------------------------------
create table public.households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  kind           public.household_kind not null,
  base_currency  public.currency_code not null default 'BRL',
  timezone       text not null default 'America/Sao_Paulo'
                 check (app_private.is_valid_timezone(timezone)),
  created_by     uuid not null references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1
);

create trigger households_touch
  before update on public.households
  for each row execute function app_private.touch_row();

create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          public.household_role not null,
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- Espaço pessoal tem exatamente um membro (o próprio dono).
create function app_private.enforce_personal_single_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.household_kind;
begin
  select h.kind into v_kind
  from public.households h
  where h.id = new.household_id
  for update;  -- serializa inclusões concorrentes no mesmo espaço

  if v_kind = 'personal' and exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id
  ) then
    raise exception 'Espaço pessoal não admite outros membros'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger household_members_personal_single
  before insert on public.household_members
  for each row execute function app_private.enforce_personal_single_member();

-- -----------------------------------------------------------------------------
-- Funções auxiliares de autorização (usadas pelas políticas RLS)
-- security definer: leem household_members sem recursão de RLS.
-- -----------------------------------------------------------------------------
create function app_private.has_household_role(
  p_household_id uuid,
  p_min_role public.household_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
      and m.role <= p_min_role
  );
$$;

create function app_private.shares_household(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs
      on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function app_private.has_household_role(uuid, public.household_role) from public;
revoke all on function app_private.shares_household(uuid) from public;
grant execute on function app_private.has_household_role(uuid, public.household_role) to authenticated;
grant execute on function app_private.shares_household(uuid) to authenticated;
revoke all on function app_private.handle_new_user() from public;
revoke all on function app_private.is_valid_timezone(text) from public;
-- Usada em CHECK constraints: quem escreve na tabela precisa de EXECUTE.
grant execute on function app_private.is_valid_timezone(text) to authenticated;
revoke all on function app_private.touch_row() from public;
revoke all on function app_private.enforce_personal_single_member() from public;
revoke all on function app_private.prevent_audit_mutation() from public;

-- -----------------------------------------------------------------------------
-- Privilégios (mínimo necessário). O Supabase concede ALL a anon/authenticated
-- por padrão em `public`; revogamos e concedemos apenas o necessário.
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.households, public.household_members
  from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, timezone) on public.profiles to authenticated;

grant select on public.households to authenticated;
grant update (name, timezone) on public.households to authenticated;

grant select on public.household_members to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy profiles_select_self_or_comember on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app_private.shares_household(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy households_select_member on public.households
  for select to authenticated
  using (app_private.has_household_role(id, 'viewer'));

create policy households_update_admin on public.households
  for update to authenticated
  using (app_private.has_household_role(id, 'admin'))
  with check (app_private.has_household_role(id, 'admin'));

create policy household_members_select_member on public.household_members
  for select to authenticated
  using (app_private.has_household_role(household_id, 'viewer'));

-- -----------------------------------------------------------------------------
-- RPC: criar espaço (transacional e idempotente)
-- -----------------------------------------------------------------------------
create function public.create_household(
  p_name text,
  p_kind public.household_kind,
  p_idempotency_key uuid,
  p_timezone text default 'America/Sao_Paulo'
)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := (select auth.uid());
  v_name      text := btrim(coalesce(p_name, ''));
  v_hash      text;
  v_existing  app_private.idempotency_keys;
  v_household public.households;
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotência obrigatória' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Nome do espaço deve ter entre 1 e 80 caracteres' using errcode = 'check_violation';
  end if;
  if not app_private.is_valid_timezone(p_timezone) then
    raise exception 'Fuso horário inválido' using errcode = 'invalid_parameter_value';
  end if;

  v_hash := md5(concat_ws('|', v_name, p_kind::text, p_timezone));

  -- Reserva a chave. Requisições concorrentes com a mesma chave esperam o
  -- commit da primeira (índice único) e então seguem pelo ramo "existente".
  insert into app_private.idempotency_keys (user_id, operation, key, request_hash)
  values (v_user_id, 'create_household', p_idempotency_key, v_hash)
  on conflict do nothing;

  if not found then
    select * into v_existing
    from app_private.idempotency_keys k
    where k.user_id = v_user_id
      and k.operation = 'create_household'
      and k.key = p_idempotency_key;

    if v_existing.request_hash <> v_hash then
      raise exception 'Chave de idempotência reutilizada com parâmetros diferentes'
        using errcode = 'unique_violation';
    end if;

    select * into v_household from public.households h where h.id = v_existing.resource_id;
    return v_household;
  end if;

  insert into public.profiles (id) values (v_user_id) on conflict (id) do nothing;

  insert into public.households (name, kind, timezone, created_by)
  values (v_name, p_kind, p_timezone, v_user_id)
  returning * into v_household;

  insert into public.household_members (household_id, user_id, role)
  values (v_household.id, v_user_id, 'owner');

  update app_private.idempotency_keys k
  set resource_id = v_household.id
  where k.user_id = v_user_id
    and k.operation = 'create_household'
    and k.key = p_idempotency_key;

  insert into app_private.audit_events (actor_id, household_id, action, entity_id, metadata)
  values (v_user_id, v_household.id, 'household.created', v_household.id,
          jsonb_build_object('kind', p_kind));

  return v_household;
end;
$$;

revoke all on function public.create_household(text, public.household_kind, uuid, text) from public, anon;
grant execute on function public.create_household(text, public.household_kind, uuid, text) to authenticated;
