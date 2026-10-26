-- =============================================================================
-- Migração 0004 — Convites para o espaço familiar, perfil e lista de membros
-- -----------------------------------------------------------------------------
-- Fecha a pendência "convites e inclusão de membros" (D04/D05):
--   * owner/admin de um espaço `family` gera um código de convite de uso único
--     com validade; só o hash do código é guardado no banco;
--   * a pessoa convidada entra com a PRÓPRIA conta e informa o código;
--   * o papel do convite nunca é `owner` (owner único) e admin só convida
--     member/viewer;
--   * convites podem ser revogados enquanto não forem aceitos.
-- Entrar no espaço não dá acesso a nenhum dado financeiro: as contas exigem
-- concessão explícita do titular (D14, migração 0005).
-- =============================================================================

create table public.household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  role          public.household_role not null check (role in ('admin', 'member', 'viewer')),
  token_hash    text not null unique,
  created_by    uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_by   uuid references public.profiles (id) on delete set null,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  check (expires_at > created_at)
);
create index household_invitations_household_idx on public.household_invitations (household_id, created_at desc);

revoke all on public.household_invitations from public, anon, authenticated;
-- token_hash nunca é exposto.
grant select (id, household_id, role, created_by, created_at, expires_at, accepted_by, accepted_at, revoked_at)
  on public.household_invitations to authenticated;

alter table public.household_invitations enable row level security;

create policy household_invitations_select_admin on public.household_invitations
  for select to authenticated
  using (app_private.has_household_role(household_id, 'admin'));

create function app_private.hash_invitation_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'UTF8')), 'hex');
$$;
revoke all on function app_private.hash_invitation_code(text) from public;

-- Gera um convite e devolve o código UMA única vez (não é recuperável depois).
create function public.create_household_invitation(
  p_household_id uuid,
  p_role public.household_role default 'member',
  p_valid_days integer default 7
)
returns table (invitation_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_actor_role public.household_role;
  v_kind       public.household_kind;
  v_code       text;
  v_id         uuid;
  v_expires    timestamptz;
begin
  if v_actor is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if p_valid_days is null or p_valid_days not between 1 and 30 then
    raise exception 'Validade deve ser de 1 a 30 dias' using errcode = 'invalid_parameter_value';
  end if;

  select m.role, h.kind into v_actor_role, v_kind
  from public.household_members m
  join public.households h on h.id = m.household_id
  where m.household_id = p_household_id and m.user_id = v_actor;

  if v_actor_role is null or v_actor_role > 'admin' then
    raise exception 'Sem permissão para convidar neste espaço' using errcode = 'insufficient_privilege';
  end if;
  if v_kind <> 'family' then
    raise exception 'Espaço pessoal não admite convites' using errcode = 'check_violation';
  end if;
  if p_role is null or p_role = 'owner' or (v_actor_role = 'admin' and p_role = 'admin') then
    raise exception 'Papel de convite não permitido' using errcode = 'insufficient_privilege';
  end if;

  -- 122 bits aleatórios (gen_random_uuid usa o gerador criptográfico do PostgreSQL).
  v_code := upper(replace(gen_random_uuid()::text, '-', ''));
  v_expires := now() + make_interval(days => p_valid_days);

  insert into public.household_invitations (household_id, role, token_hash, created_by, expires_at)
  values (p_household_id, p_role, app_private.hash_invitation_code(v_code), v_actor, v_expires)
  returning id into v_id;

  insert into app_private.audit_events (actor_id, household_id, action, entity_id, metadata)
  values (v_actor, p_household_id, 'household_invitation.created', v_id, jsonb_build_object('role', p_role));

  invitation_id := v_id;
  code := v_code;
  expires_at := v_expires;
  return next;
end;
$$;

-- Aceita um convite com a conta logada. Mensagem genérica para código
-- inexistente, expirado, revogado ou já usado (não revela qual).
create function public.accept_household_invitation(p_code text)
returns public.households
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_invitation public.household_invitations;
  v_household  public.households;
begin
  if v_user is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation
  from public.household_invitations i
  where i.token_hash = app_private.hash_invitation_code(p_code)
  for update;

  if v_invitation.id is null
     or v_invitation.accepted_at is not null
     or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() then
    raise exception 'Convite inválido ou expirado' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1 from public.household_members m
    where m.household_id = v_invitation.household_id and m.user_id = v_user
  ) then
    raise exception 'Você já participa deste espaço' using errcode = 'unique_violation';
  end if;

  insert into public.profiles (id) values (v_user) on conflict (id) do nothing;

  insert into public.household_members (household_id, user_id, role)
  values (v_invitation.household_id, v_user, v_invitation.role);

  update public.household_invitations i
  set accepted_by = v_user, accepted_at = now()
  where i.id = v_invitation.id;

  insert into app_private.audit_events (actor_id, household_id, action, entity_id, metadata)
  values (v_user, v_invitation.household_id, 'household_invitation.accepted', v_invitation.id,
          jsonb_build_object('role', v_invitation.role));

  select * into v_household from public.households h where h.id = v_invitation.household_id;
  return v_household;
end;
$$;

create function public.revoke_household_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_invitation public.household_invitations;
begin
  if v_actor is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invitation from public.household_invitations i where i.id = p_invitation_id for update;

  if v_invitation.id is null or not app_private.has_household_role(v_invitation.household_id, 'admin') then
    raise exception 'Sem permissão para alterar este convite' using errcode = 'insufficient_privilege';
  end if;
  if v_invitation.accepted_at is not null or v_invitation.revoked_at is not null then
    raise exception 'Convite já utilizado ou revogado' using errcode = 'check_violation';
  end if;

  update public.household_invitations i set revoked_at = now() where i.id = p_invitation_id;

  insert into app_private.audit_events (actor_id, household_id, action, entity_id, metadata)
  values (v_actor, v_invitation.household_id, 'household_invitation.revoked', p_invitation_id, '{}'::jsonb);
end;
$$;

-- Membros de um espaço com o nome de exibição (RLS do chamador se aplica).
create function public.list_household_members(p_household_id uuid)
returns table (user_id uuid, role public.household_role, display_name text, joined_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.user_id, m.role, p.display_name, m.created_at
  from public.household_members m
  left join public.profiles p on p.id = m.user_id
  where m.household_id = p_household_id
  order by m.role, m.created_at;
$$;

-- Atualiza o nome de exibição do próprio perfil.
create function public.update_my_profile(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_name    text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'Nome deve ter no máximo 80 caracteres' using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, display_name) values (v_user, v_name)
  on conflict (id) do update set display_name = excluded.display_name
  returning * into v_profile;
  return v_profile;
end;
$$;

revoke all on function public.create_household_invitation(uuid, public.household_role, integer) from public, anon;
revoke all on function public.accept_household_invitation(text) from public, anon;
revoke all on function public.revoke_household_invitation(uuid) from public, anon;
revoke all on function public.list_household_members(uuid) from public, anon;
revoke all on function public.update_my_profile(text) from public, anon;
grant execute on function public.create_household_invitation(uuid, public.household_role, integer) to authenticated;
grant execute on function public.accept_household_invitation(text) to authenticated;
grant execute on function public.revoke_household_invitation(uuid) to authenticated;
grant execute on function public.list_household_members(uuid) to authenticated;
grant execute on function public.update_my_profile(text) to authenticated;
