# Arquitetura

## Visão geral

```
Navegador (React SPA)
  │  chave publicável (anon) + JWT do usuário
  ▼
Supabase: Auth (sessões) + PostgREST (API REST/RPC)
  │  papel `authenticated`, auth.uid()
  ▼
PostgreSQL: RLS + privilégios por coluna + funções RPC (security definer)
```

Não há servidor de aplicação próprio nesta fase. A **autorização acontece no
banco**: políticas RLS, `GRANT` por coluna e funções RPC que validam entrada,
executam em transação e registram auditoria. O frontend apenas melhora a
experiência (ex.: `RequireAuth` redireciona para login), nunca decide acesso.
Operações que exigirem segredos (pagamentos, IA, importação) usarão funções de
servidor (Supabase Edge Functions ou equivalente) em fases futuras.

## Estrutura de pastas

```
src/
  app/            composição: rotas (App.tsx) e injeção de serviços
  components/     ui/ (Button, estados de tela) e layout/ (AppShell)
  config/         leitura e validação das variáveis de ambiente
  features/       módulos por domínio
    auth/         AuthProvider, contexto e RequireAuth
    households/   espaços: tipos, validação, repositório Supabase, página
  lib/            primitivas puras: money, dates, errors, logger
  pages/          páginas sem domínio próprio (início, login, 404, config)
  services/       clientes externos (Supabase, Auth)
  test/           setup, dublês de teste e helpers de renderização
supabase/
  migrations/     migrações SQL versionadas (formato Supabase CLI)
  tests/          testes de integração do banco + shim local do Supabase
  e2e/            seed e limpeza para o projeto Supabase de desenvolvimento
scripts/          test-db.sh (PostgreSQL efêmero) e e2e/validar-supabase.ts
docs/             documentação técnica
```

Cada módulo de domínio futuro (contas, lançamentos, cartões...) deve seguir o
padrão de `features/households`: `types.ts` (contrato espelhando o banco),
`validation.ts` (zod, mesmas regras das constraints), `repository.ts`
(acesso via Supabase) e páginas/componentes. A interface depende de contratos
(`HouseholdRepository`, `AuthService`) injetados por `ServicesProvider`, o que
permite testar a UI sem rede.

## Inventário de tecnologias

Versões fixadas exatamente em `package.json` e `package-lock.json`; todas
publicadas há pelo menos duas semanas na data da escolha (2026-10-20).

| Pacote | Versão | Uso |
| --- | --- | --- |
| react / react-dom | 19.3.0 | UI |
| react-router | 8.4.0 | navegação |
| @supabase/supabase-js | 2.117.2 | Auth + API do banco |
| zod | 4.6.5 | validação de configuração e formulários |
| vite / @vitejs/plugin-react | 8.3.2 / 6.1.2 | dev server e build |
| typescript | 6.0.3 | tipos (7.x ainda não é suportado pelo typescript-eslint) |
| tailwindcss / @tailwindcss/vite | 4.3.3 | estilos |
| vitest / jsdom | 5.0.3 / 30.1.2 | testes |
| @testing-library/react, jest-dom, user-event | 16.3.3, 7.0.1, 14.6.7 | testes de componentes |
| eslint, typescript-eslint, plugins react-hooks/refresh | 10.12.0, 8.71.1, 7.1.1, 0.5.7 | lint |
| pg / @types/pg | 8.23.1 | testes de integração do banco (dev) |

Ambiente verificado: Node 22.22.0, npm 10.9.4 (lockfile gerado com npm
11.21.1), PostgreSQL 16.15.

## Fluxos implementados

- **Sessão**: `AuthProvider` lê a sessão do Supabase e escuta mudanças;
  rotas protegidas por `RequireAuth`.
- **Espaços**: lista via `select` (filtrado por RLS) e criação via RPC
  `create_household` com chave de idempotência gerada por intenção do usuário.
- **Membros**: revogação/saída via RPC `remove_household_member` (sem tela
  ainda; usada pelo roteiro E2E). Convites ficam para a fase de
  compartilhamento.

## Modelo de acesso (D04, D05, D14)

- Dado privado → espaço `personal` do usuário (só ele é membro).
- Dado familiar → espaço `family`; acesso exige vínculo ativo.
- Papel define o teto do que o membro pode fazer; dados financeiros futuros
  exigirão também concessão explícita por recurso.
- Ser owner/admin de uma família não dá acesso a espaços pessoais.
