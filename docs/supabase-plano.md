# Plano de configuração — Supabase de desenvolvimento

**Status: proposta. Nada foi criado, ativado ou contratado.** Executar somente
após autorização explícita do responsável.

## Fontes e confiabilidade das informações do fornecedor

O site `supabase.com` está bloqueado pela rede deste ambiente. Os dados abaixo
foram lidos em 2026-10-20 do **código-fonte público** do site e da
documentação da Supabase no GitHub (`supabase/supabase`, branch `master`):

- `packages/shared-data/plans.ts` (planos e limites exibidos na página de preços)
- `packages/shared-data/regions.ts` (regiões)
- `packages/shared-data/config.ts` e `apps/docs/content/_partials/auth_rate_limits.mdx` (limites do Auth)
- `apps/docs/content/guides/auth/auth-smtp.mdx`, `.../auth/password-security.mdx`
- `apps/docs/content/guides/platform/backups.mdx`, `.../platform/upgrading.mdx`
- `apps/docs/content/guides/getting-started/api-keys.mdx`, `.../api/securing-your-api.mdx`

O conteúdo publicado pode diferir do código-fonte. **Todos os valores devem
ser reconfirmados na tela de criação do projeto e na página de preços antes
de aprovar.** Itens sem fonte ficam marcados como *pendente de confirmação*.

## 1. Finalidade e nome

- **Finalidade**: validar de ponta a ponta a Fundação Técnica (Auth, RLS,
  RPC, idempotência, revogação) com usuários e dados **fictícios**. Não é
  homologação nem produção e nunca receberá dados financeiros reais.
- **Nome sugerido**: `financas-em-familia-dev`.
- **Organização**: a do responsável, plano Free. Senha do banco gerada pelo
  painel e guardada em gerenciador de senhas (nunca no Git ou no chat).

## 2. Região

**Recomendada: South America (São Paulo), código `sa-east-1`** (consta na
lista de regiões).

- Latência: usuários previstos no Brasil; menor latência para testes reais.
- Localização dos dados: mantém os dados no Brasil, o que simplifica a
  aderência à LGPD quando a produção for criada. Para o ambiente de
  desenvolvimento (dados fictícios) a localização não é crítica, mas usar a
  mesma região da futura produção torna a validação mais fiel.
- Pendente de confirmação: disponibilidade de `sa-east-1` para projetos
  Free no momento da criação.

## 3. Recursos necessários

| Recurso | Uso | Configuração |
| --- | --- | --- |
| PostgreSQL | esquema das migrações 0001–0003 | padrão do projeto |
| Data API (PostgREST) | `select` nas tabelas e RPCs `create_household`/`remove_household_member` | esquemas expostos: somente `public` (não expor `app_private`) |
| Auth (e-mail e senha) | login dos usuários de teste | cadastro público desligado; usuários criados pelo painel |
| RLS | isolamento | já definido nas migrações |
| Storage, Edge Functions, Realtime, IA | **não usados** | não ativar |

## 4. Configurações e variáveis

Frontend (`.env.local`, nunca versionado):

| Variável | Valor |
| --- | --- |
| `VITE_APP_ENV` | `development` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | chave **publicável** (`sb_publishable_...`) ou legada `anon`. Nunca `sb_secret_`/`service_role` (o app recusa). |

Script E2E (somente no terminal de quem executa):
`E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_PASSWORD`,
`E2E_CONFIRM_NON_PRODUCTION=sim` e, opcionalmente, `E2E_EMAIL_*`.

Aplicação de migrações (somente no terminal, nunca no repositório):
`SUPABASE_ACCESS_TOKEN` (token pessoal da CLI) e a senha do banco.

Configurações do painel:

| Onde | Ajuste |
| --- | --- |
| Authentication > Sign In / Providers | E-mail habilitado; **cadastro de novos usuários desligado** durante a validação; demais provedores desligados |
| Authentication > URL Configuration | Site URL `http://localhost:5173`; redirecionamentos só para `http://localhost:5173/**` |
| Authentication (configurações de senha) | comprimento mínimo ≥ 8 (recomendado 12) |
| Authentication > Rate Limits | manter padrões |
| API / Data API | expor somente `public` |
| Settings > API Keys | usar chave publicável; não copiar chave secreta para lugar nenhum |

## 5. Aplicar as migrações

```bash
npm ci
npm run check && npm run test:db              # tudo verde antes de aplicar
npx supabase@<versão fixada> login             # token pessoal, interativo
npx supabase@<versão fixada> link --project-ref <ref>
npx supabase@<versão fixada> db push --dry-run # conferir: 0001, 0002, 0003
npx supabase@<versão fixada> db push
npx supabase@<versão fixada> migration list    # local e remoto iguais
```

Alternativa sem CLI: colar os três arquivos, em ordem, no SQL Editor.
**Não** aplicar `supabase/tests/local-supabase-shim.sql` (só para testes locais).
Depois: abrir Advisors > Security e Performance e registrar os alertas.

## 6. Usuários de teste

1. Authentication > Users > Add user > *Create new user*, com
   **Auto Confirm User** marcado, para: `e2e-owner`, `e2e-admin`,
   `e2e-member`, `e2e-viewer`, `e2e-stranger` `@exemplo.test`, todos com a
   mesma senha forte gerada para o teste.
2. Conferir em Table Editor > `profiles` que cada um ganhou perfil (gatilho).
3. SQL Editor: executar `supabase/e2e/seed-familia.sql`.

Pendente de confirmação: se o painel aceita o domínio reservado
`exemplo.test`. Se recusar, usar outro domínio fictício e informar via
`E2E_EMAIL_*` e no seed. O SMTP embutido só entrega e-mails a membros da
equipe do projeto, por isso os usuários são criados já confirmados.

## 7. Validar as políticas RLS

- Automático: `npm run e2e:supabase` (Testes 1–6, ver
  `docs/roteiro-validacao.md`).
- No banco: `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';` deve mostrar `true` em todas.
- Advisors de segurança sem alertas críticos.

## 8. Testes de ponta a ponta

Seguir `docs/roteiro-validacao.md`: script automatizado (API) e roteiro
manual na interface (login/logout, criação e recarga, sessão expirada,
erro de conexão).

## 9. Limites, custos e riscos do plano Free

Segundo o código-fonte do site (reconfirmar):

| Item | Free |
| --- | --- |
| Preço | US$ 0/mês |
| Projetos ativos | 2 por organização |
| Pausa | após 1 semana de inatividade |
| Banco | 500 MB; CPU compartilhada, 500 MB de RAM |
| Egress | 5 GB (+ 5 GB em cache) |
| Usuários ativos/mês | 50.000 |
| Armazenamento de arquivos | 1 GB |
| Suporte | comunidade |
| Backups automáticos | **não** (backups diários são citados só para Pro, Team e Enterprise; a documentação recomenda `supabase db dump` regular no Free) |
| PITR | não (add-on pago de planos pagos) |
| Proteção contra senhas vazadas | não (Pro ou superior) |
| SMTP embutido | só envia para membros da equipe; 2 e-mails/hora; sem SLA |
| Limites do Auth (padrão) | login/cadastro 30 req/5 min por IP; token 150 req/5 min por IP; verificação 30 req/5 min; MFA 15 req/min |
| Projeto pausado | pode ser restaurado pelo painel dentro de uma janela (a documentação cita 1 ano; imagem cita 90 dias: **pendente de confirmação**) |

Custos potenciais: nenhum enquanto o projeto permanecer no Free. Haveria
custo apenas se a organização fosse migrada para um plano pago (Pro a partir
de US$ 25/mês no código-fonte) ou se add-ons fossem ativados. **Não fazer
upgrade sem autorização.** Pendentes de confirmação: preço em reais,
impostos, custo de MFA por telefone, comportamento exato ao exceder limites
no Free.

Riscos:
- Pausa por inatividade interrompe a validação (restaurar pelo painel).
- Sem backup automático: dados de teste podem ser perdidos (aceitável por
  serem fictícios).
- Limites de e-mail impedem testar cadastro e recuperação de senha com
  e-mails reais sem SMTP próprio (fora do escopo).
- Recursos de segurança como proteção contra senhas vazadas não existem no
  Free; não usar este projeto como produção.

## 10. Interromper ou excluir com segurança

- **Interromper**: Project Settings > General > *Pause project* (ou deixar
  pausar por inatividade). Antes, se houver algo a preservar:
  `npx supabase db dump -f dev-schema.sql` (sem dados reais; não versionar dumps com dados).
- **Remover dados de teste**: `supabase/e2e/limpar-e2e.sql` (conferir o
  SELECT antes; operação destrutiva somente com autorização) e remover os
  usuários `e2e-*` em Authentication > Users.
- **Revogar acessos**: excluir o token pessoal da CLI em Account > Access
  Tokens; rotacionar/desabilitar a chave publicável se foi exposta fora do
  necessário.
- **Excluir o projeto** (irreversível, exige autorização explícita):
  Project Settings > General > *Delete project*, confirmando o nome. Depois,
  apagar `.env.local` das máquinas.
