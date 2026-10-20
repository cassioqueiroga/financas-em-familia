-- =============================================================================
-- Migração 0003 — Revogação de vínculos e consolidação de D04/D05
-- -----------------------------------------------------------------------------
-- D04 (aprovada): dados privados ficam no espaço pessoal do usuário; dados
-- familiares são compartilhados explicitamente e de forma revogável; a
-- administração familiar não dá acesso a registros privados.
-- D05 (aprovada): papéis owner/admin/member/viewer; o papel, isoladamente,
-- não concede acesso a dados não compartilhados.
--
-- Esta migração:
--   1. Garante no máximo um owner por espaço.
--   2. Cria a RPC `remove_household_member` (revogação de vínculo e saída
--      voluntária). O acesso é verificado a cada consulta pela tabela de
--      membros, portanto a revogação vale imediatamente para as requisições
--      seguintes, sem depender de expiração de sessão.
--   3. Documenta no banco que `has_household_role` é apenas o teto do papel.
-- Não inclui convites nem inclusão de membros (fase de compartilhamento).
-- =============================================================================

create unique index household_members_single_owner
  on public.household_members (household_id)
  where role = 'owner';

comment on function app_private.has_household_role(uuid, public.household_role) is
  'Verifica vínculo ativo e papel mínimo no espaço. É apenas o TETO do papel (D05): '
  'políticas de dados financeiros futuros devem combinar esta verificação com a '
  'concessão explícita de compartilhamento do recurso, nunca usá-la isoladamente.';

-- Regras (D05):
--   * Qualquer membro pode sair do espaço, exceto o owner (transferência de
--     propriedade ainda não existe).
--   * owner remove admin, member e viewer.
--   * admin remove member e viewer (não remove outro admin nem o owner).
--   * member e viewer só podem remover a si mesmos.
--   * Quem não é membro recebe a mesma recusa genérica, sem revelar se o
--     espaço ou o vínculo existem.
create function public.remove_household_member(
  p_household_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select auth.uid());
  v_actor_role   public.household_role;
  v_target_role  public.household_role;
begin
  if v_actor is null then
    raise exception 'Autenticação obrigatória' using errcode = 'insufficient_privilege';
  end if;
  if p_household_id is null or p_user_id is null then
    raise exception 'Espaço e usuário são obrigatórios' using errcode = 'invalid_parameter_value';
  end if;

  -- Serializa alterações de vínculo no mesmo espaço.
  perform 1 from public.households h where h.id = p_household_id for update;

  select m.role into v_actor_role
  from public.household_members m
  where m.household_id = p_household_id and m.user_id = v_actor;

  if v_actor_role is null then
    raise exception 'Sem permissão para alterar este espaço' using errcode = 'insufficient_privilege';
  end if;

  select m.role into v_target_role
  from public.household_members m
  where m.household_id = p_household_id and m.user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Vínculo não encontrado' using errcode = 'no_data_found';
  end if;

  if p_user_id = v_actor then
    if v_actor_role = 'owner' then
      raise exception 'O owner não pode sair do espaço' using errcode = 'insufficient_privilege';
    end if;
  elsif not (
       (v_actor_role = 'owner' and v_target_role in ('admin', 'member', 'viewer'))
    or (v_actor_role = 'admin' and v_target_role in ('member', 'viewer'))
  ) then
    raise exception 'Sem permissão para remover este membro' using errcode = 'insufficient_privilege';
  end if;

  delete from public.household_members m
  where m.household_id = p_household_id and m.user_id = p_user_id;

  insert into app_private.audit_events (actor_id, household_id, action, entity_id, metadata)
  values (v_actor, p_household_id, 'household_member.removed', p_user_id,
          jsonb_build_object('role', v_target_role, 'self', p_user_id = v_actor));
end;
$$;

revoke all on function public.remove_household_member(uuid, uuid) from public, anon;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
