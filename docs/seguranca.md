# Segurança

## Controles implementados (com evidência em teste)

| Controle | Onde | Teste |
| --- | --- | --- |
| Autorização no banco via RLS em todas as tabelas de `public` | migração 0002 | `supabase/tests/households.test.ts` |
| Administração familiar não acessa espaços pessoais (D04) | vínculo obrigatório por espaço | `supabase/tests/membership.test.ts` |
| Revogação de vínculo com efeito imediato, inclusive em sessão aberta | `remove_household_member` (migração 0003) | idem |
| Regras de remoção por papel e no máximo um owner (D05/D15) | migração 0003 | idem |
| `anon` sem EXECUTE em funções e sem acesso a tabelas de `public`; `authenticated` sem INSERT/DELETE direto | grants | teste de convenções |
| Isolamento entre espaços: estranho não vê espaço, membros nem perfis | RLS | idem |
| Papéis por espaço: só `owner`/`admin` alteram o espaço | política `households_update_admin` | idem |
| Privilégio mínimo: `anon` sem acesso; `authenticated` sem insert/delete direto; update só em colunas liberadas | `revoke`/`grant` | idem |
| Escrita multi-registro só via RPC transacional que valida entrada no servidor | `create_household` | idem |
| Idempotência contra requisições repetidas/concorrentes | `app_private.idempotency_keys` | idem |
| Auditoria somente inclusão, inacessível a usuários | `app_private.audit_events` | idem |
| `search_path` fixo em funções `security definer` | migrações | teste de convenções |
| Frontend recusa chave privilegiada e exige HTTPS fora de dev | `src/config/env.ts` | `env.test.ts` |
| Mensagens de erro sem detalhes técnicos | `src/lib/errors.ts` | `errors.test.ts`, `HouseholdsPage.test.tsx` |
| Logs com redação de senha, token, e-mail, valores, JWT | `src/lib/logger.ts` (+ lint proíbe `console.log`) | `logger.test.ts` |
| Segredos fora do Git | `.gitignore`, `.env.example` sem valores | revisão |
| Aviso visual de ambiente não produtivo | `AppShell` | `App.test.tsx` |
| Sessão com fluxo PKCE e renovação automática | `src/services/supabase.ts` | não testado (requer Supabase) |

## Revisão de segurança — Fase 1.1 (2026-10-20)

Verificado localmente (sem serviço externo):

| Item | Resultado | Evidência |
| --- | --- | --- |
| Chaves privilegiadas no frontend | nenhuma | `src/` só referencia `service_role`/`sb_secret_` para recusá-las; busca por `sb_secret_…` e JWT no `dist/` sem ocorrências |
| Somente credencial publicável no cliente | sim | `src/config/env.ts` recusa chaves privilegiadas (testado); `src/services/supabase.ts` usa só URL + chave publicável |
| Variáveis documentadas e validadas | sim | `docs/ambientes.md`, `.env.example`, `env.test.ts` |
| RLS em todas as tabelas expostas | sim | teste "todas as tabelas de public têm RLS habilitado" |
| Políticas corretas para individuais e familiares | sim, para as tabelas existentes | `households.test.ts` e `membership.test.ts` |
| Privilégios mínimos | sim | grants por coluna; testes de privilégio de `anon` e `authenticated` |
| RPCs protegidas e com validação no servidor | sim | `create_household` e `remove_household_member` exigem `auth.uid()`, validam entrada, `search_path` vazio, sem EXECUTE para `anon` |
| Erros e logs seguros | sim | `errors.ts`/`logger.ts` testados; `console.log` proibido pelo lint |
| Segredos no Git | nenhum | só `.env.example` versionado; histórico sem chaves (busca por padrões `sb_secret_` e JWT encontrou apenas um valor fictício de teste) |
| Sessão | parcial | PKCE e renovação automática configurados; token inválido/expirado mapeado para "sessão expirada"; **recuperação de senha não implementada** |
| Migrações compatíveis com a arquitetura | sim | aplicadas em PostgreSQL 16 com shim do Supabase; concedem privilégios explicitamente, o que funciona tanto com os grants automáticos antigos do Supabase quanto com o novo padrão sem grants automáticos |
| Operações destrutivas não autorizadas | nenhuma | migrações sem `drop`/`truncate`; o único `delete` é a remoção de vínculo autorizada pela RPC; limpeza E2E é manual e comentada |

**Não verificado** (depende do serviço externo ou da hospedagem; não
declarar concluído antes da validação real): MFA, política de senha, limites
de autenticação, proteção contra senhas vazadas (indisponível no Free),
SMTP, URLs de redirecionamento, cabeçalhos de segurança (CSP, HSTS,
frame-ancestors), backup e restauração (sem backup automático no Free),
advisors do Supabase, exposição somente do esquema `public` na Data API.

## Riscos conhecidos e mitigação

| Risco | Situação | Mitigação proposta |
| --- | --- | --- |
| Token de sessão no `localStorage` (padrão do supabase-js) exposto a XSS | aceito nesta fase | React escapa conteúdo; proibir `dangerouslySetInnerHTML`; aplicar CSP restritiva na hospedagem |
| Ausência de cabeçalhos de segurança (CSP, HSTS, frame-ancestors) | pendente | configurar na hospedagem escolhida |
| Políticas de senha, confirmação de e-mail, MFA e limite de tentativas | dependem da configuração do projeto Supabase | definir ao criar o projeto |
| Funções `security definer` executam como dono | mitigado | validação explícita de `auth.uid()`, `search_path` vazio, `revoke` de `public`/`anon` |
| `FORCE ROW LEVEL SECURITY` não usado | decisão | RPCs dependem do dono para escrever; acesso direto do dono só por migrações/CI |
| Dependências de terceiros | mitigado parcialmente | versões exatas, publicadas há ≥ 2 semanas, `npm audit` sem vulnerabilidades em 2026-10-20 |
| Integração real nunca exercitada | pendente | `npm run e2e:supabase` e `docs/roteiro-validacao.md` quando houver projeto |
| Perfis visíveis a co-membros (nome de exibição e fuso) | aceito (D04) | sem dados financeiros em perfis |
| Exclusão de conta bloqueada se o usuário criou espaços (`created_by` com `on delete restrict`) | pendente | definir política de transferência/exclusão antes da produção (LGPD) |

## Regras para as próximas fases

- Toda tabela nova: RLS habilitado, `revoke` explícito, teste de isolamento.
- Dados financeiros: política = vínculo + papel suficiente **e** concessão
  explícita do recurso (D14). Nunca `has_household_role` sozinho.
- Dados privados ficam no espaço pessoal; compartilhar é ação explícita e
  revogável (D04).
- Escritas que afetam saldos ou vários registros: somente via RPC
  transacional com chave de idempotência.
- Nada de segredo em `VITE_*`. Integrações com segredo em funções de servidor.
- Dados de teste sempre fictícios (`@exemplo.test`).
