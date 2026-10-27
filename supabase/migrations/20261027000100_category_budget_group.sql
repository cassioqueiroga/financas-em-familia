-- =============================================================================
-- Migração 0008 — Grupo 50-30-20 escolhido por categoria (D31)
-- -----------------------------------------------------------------------------
--   * Só ADICIONA: uma coluna opcional em categories e uma função nova.
--     Nenhum dado existente é alterado; update_category continua igual.
--   * budget_group vale só para categorias de despesa:
--       'essential' = necessidade, 'lifestyle' = estilo de vida,
--       null        = automático (as categorias padrão seguem a regra do app;
--                     as criadas pelo casal ficam "sem grupo").
--   * Qualquer membro com papel 'member' ou superior escolhe o grupo, como em
--     update_category, com controle de versão.
-- =============================================================================

alter table public.categories
  add column budget_group text
    check (budget_group in ('essential', 'lifestyle')),
  add constraint categories_budget_group_expense_only
    check (budget_group is null or kind = 'expense');

create function public.set_category_group(
  p_category_id uuid,
  p_expected_version integer,
  p_group text
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := app_private.require_user();
  v_category public.categories;
begin
  select * into v_category from public.categories c where c.id = p_category_id for update;
  if v_category.id is null or not app_private.has_household_role(v_category.household_id, 'member') then
    raise exception 'Sem permissão neste espaço' using errcode = 'insufficient_privilege';
  end if;
  if v_category.version <> p_expected_version then
    raise exception 'A categoria foi alterada por outra pessoa. Recarregue.' using errcode = 'serialization_failure';
  end if;
  if v_category.kind <> 'expense' and p_group is not null then
    raise exception 'Grupo só vale para categorias de despesa' using errcode = 'check_violation';
  end if;
  if p_group is not null and p_group not in ('essential', 'lifestyle') then
    raise exception 'Grupo inválido' using errcode = 'check_violation';
  end if;

  update public.categories c
  set budget_group = p_group
  where c.id = p_category_id
  returning * into v_category;

  perform app_private.audit(v_category.household_id, 'category.group_set', v_category.id, jsonb_build_object('group', p_group));
  return v_category;
end;
$$;

revoke all on function public.set_category_group(uuid, integer, text) from public, anon;
grant execute on function public.set_category_group(uuid, integer, text) to authenticated;
