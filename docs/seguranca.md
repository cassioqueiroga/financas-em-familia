# Segurança

## Controles implementados (com evidência em teste)

| Controle | Onde | Teste |
| --- | --- | --- |
| Autorização no banco via RLS em todas as tabelas de `public` | migração 0002 | `supabase/tests/households.test.ts` |
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

## Riscos conhecidos e mitigação

| Risco | Situação | Mitigação proposta |
| --- | --- | --- |
| Token de sessão no `localStorage` (padrão do supabase-js) exposto a XSS | aceito nesta fase | React escapa conteúdo; proibir `dangerouslySetInnerHTML`; aplicar CSP restritiva na hospedagem |
| Ausência de cabeçalhos de segurança (CSP, HSTS, frame-ancestors) | pendente | configurar na hospedagem escolhida |
| Políticas de senha, confirmação de e-mail, MFA e limite de tentativas | dependem da configuração do projeto Supabase | definir ao criar o projeto |
| Funções `security definer` executam como dono | mitigado | validação explícita de `auth.uid()`, `search_path` vazio, `revoke` de `public`/`anon` |
| `FORCE ROW LEVEL SECURITY` não usado | decisão | RPCs dependem do dono para escrever; acesso direto do dono só por migrações/CI |
| Dependências de terceiros | mitigado parcialmente | versões exatas, publicadas há ≥ 2 semanas, `npm audit` sem vulnerabilidades em 2026-10-20 |
| Integração real nunca exercitada | pendente | testes ponta a ponta quando houver projeto Supabase de desenvolvimento |

## Regras para as próximas fases

- Toda tabela nova: RLS habilitado, políticas por papel, `revoke` explícito,
  teste de isolamento.
- Escritas que afetam saldos ou vários registros: somente via RPC
  transacional com chave de idempotência.
- Nada de segredo em `VITE_*`. Integrações com segredo em funções de servidor.
- Dados de teste sempre fictícios (`@exemplo.test`).
