-- =============================================================================
-- PREPARAÇÃO DO TESTE 4 (permissões familiares) — SOMENTE projeto de DESENVOLVIMENTO.
-- -----------------------------------------------------------------------------
-- Executar no SQL Editor do projeto Supabase de desenvolvimento DEPOIS de criar
-- os usuários de teste (fictícios) em Authentication > Users.
-- Cria (ou reaproveita) o espaço familiar "E2E Família" do owner e define os
-- papéis admin/member/viewer. Pode ser executado de novo para restaurar os
-- vínculos após o Teste 5 (revogação). O usuário "estranho" não recebe vínculo.
-- Inclusão de membros ainda não tem fluxo no app (fase de compartilhamento).
-- Ajuste os e-mails abaixo se usar outros.
-- =============================================================================
do $$
declare
  v_owner   uuid := (select id from auth.users where email = 'e2e-owner@exemplo.test');
  v_admin   uuid := (select id from auth.users where email = 'e2e-admin@exemplo.test');
  v_member  uuid := (select id from auth.users where email = 'e2e-member@exemplo.test');
  v_viewer  uuid := (select id from auth.users where email = 'e2e-viewer@exemplo.test');
  v_family  uuid;
begin
  if v_owner is null or v_admin is null or v_member is null or v_viewer is null then
    raise exception 'Crie antes os usuários e2e-owner, e2e-admin, e2e-member e e2e-viewer @exemplo.test';
  end if;

  select h.id into v_family
  from public.households h
  where h.created_by = v_owner and h.kind = 'family' and h.name = 'E2E Família';

  if v_family is null then
    insert into public.households (name, kind, created_by)
    values ('E2E Família', 'family', v_owner)
    returning id into v_family;
    insert into public.household_members (household_id, user_id, role)
    values (v_family, v_owner, 'owner');
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_family, v_admin, 'admin'), (v_family, v_member, 'member'), (v_family, v_viewer, 'viewer')
  on conflict (household_id, user_id) do update set role = excluded.role;

  raise notice 'Espaço E2E Família: %', v_family;
end;
$$;
