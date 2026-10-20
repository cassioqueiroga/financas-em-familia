-- =============================================================================
-- Migração 0001 — Fundação do esquema
-- -----------------------------------------------------------------------------
-- Cria esquemas, tipos de domínio e utilitários compartilhados que as próximas
-- migrações usam. Não cria tabelas financeiras (escopo de fases futuras).
--
-- Convenções (ver docs/banco-de-dados.md):
--   * snake_case, tabelas no plural, PK uuid `id` (exceto tabelas de junção).
--   * Valores monetários: domínio `public.money_cents` (bigint, centavos).
--     Nunca usar real/double precision/float para dinheiro.
--   * Instantes: timestamptz (armazenado em UTC). Datas de negócio: `date`,
--     interpretadas no fuso do grupo (household.timezone).
--   * Concorrência otimista: coluna `version` incrementada por gatilho.
--   * Funções security definer sempre com `set search_path = ''` e nomes
--     totalmente qualificados.
-- =============================================================================

-- Esquema privado: tabelas e funções auxiliares que NÃO devem ser expostas
-- pela API REST do Supabase (PostgREST expõe apenas os esquemas configurados,
-- por padrão `public`).
create schema if not exists app_private;
revoke all on schema app_private from public;
-- `authenticated` precisa de USAGE para que as políticas RLS possam chamar
-- as funções auxiliares; nenhuma tabela deste esquema recebe GRANT.
grant usage on schema app_private to authenticated;

-- -----------------------------------------------------------------------------
-- Domínios
-- -----------------------------------------------------------------------------

-- Valor monetário em centavos (inteiro exato). Pode ser negativo (ex.: saldo).
create domain public.money_cents as bigint;
comment on domain public.money_cents is
  'Valor monetário em centavos (inteiro exato). Proibido usar ponto flutuante.';

-- Código de moeda ISO 4217 (três letras maiúsculas).
create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------

-- Valida um nome de fuso horário IANA (ex.: America/Sao_Paulo).
create function app_private.is_valid_timezone(p_tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_tz is null or p_tz = '' then
    return false;
  end if;
  perform now() at time zone p_tz;
  return true;
exception
  when invalid_parameter_value then
    return false;
end;
$$;

-- Mantém updated_at atualizado e incrementa `version` a cada UPDATE.
-- Clientes devem enviar `version` esperada no filtro do UPDATE
-- (ex.: `update ... where id = $1 and version = $2`) para detectar
-- alterações concorrentes (zero linhas afetadas = conflito).
create function app_private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auditoria (somente inclusão)
-- -----------------------------------------------------------------------------
create table app_private.audit_events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,
  household_id  uuid,
  action        text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_id     uuid,
  -- Metadados NÃO devem conter dados sensíveis (valores, documentos, e-mails).
  metadata      jsonb not null default '{}'::jsonb
                check (jsonb_typeof(metadata) = 'object')
);
create index audit_events_household_idx
  on app_private.audit_events (household_id, occurred_at desc);

create function app_private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events é somente inclusão (operação % proibida)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_append_only
  before update or delete on app_private.audit_events
  for each row execute function app_private.prevent_audit_mutation();

create trigger audit_events_no_truncate
  before truncate on app_private.audit_events
  for each statement execute function app_private.prevent_audit_mutation();

-- -----------------------------------------------------------------------------
-- Idempotência
-- -----------------------------------------------------------------------------
-- Operações de escrita expostas como RPC recebem uma chave de idempotência
-- gerada pelo cliente. Repetir a requisição com a mesma chave devolve o mesmo
-- recurso, sem duplicar. Reutilizar a chave com parâmetros diferentes é erro.
create table app_private.idempotency_keys (
  user_id      uuid not null,
  operation    text not null,
  key          uuid not null,
  request_hash text not null,
  resource_id  uuid,
  created_at   timestamptz not null default now(),
  primary key (user_id, operation, key)
);
