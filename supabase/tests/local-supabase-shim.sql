-- =============================================================================
-- SOMENTE PARA TESTES LOCAIS — NÃO É MIGRAÇÃO E NÃO DEVE SER APLICADO NO SUPABASE.
-- -----------------------------------------------------------------------------
-- Reproduz, em um PostgreSQL puro, o mínimo que o Supabase já fornece:
-- esquema `auth` com `auth.users` e `auth.uid()`, os papéis `anon`,
-- `authenticated` e `service_role`, e os privilégios padrão que o Supabase
-- concede em `public` (ALL para anon/authenticated). Assim os testes verificam
-- que as migrações revogam esses privilégios corretamente.
-- =============================================================================
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  create role anon nologin noinherit;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null;
end $$;
do $$
begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Privilégios padrão equivalentes aos do Supabase.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
