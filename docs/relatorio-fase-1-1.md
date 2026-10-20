# Relatório — Fase 1.1: Consolidação das decisões e preparação para validação

Data: 2026-10-20. Projeto: `/mnt/project-files/financas-em-familia` (Git
local, branch `main`, sem remoto).

**Resumo:** D04 e D05 estão registradas como aprovadas e refletidas no
código. A comparação encontrou três divergências, corrigidas e testadas
localmente: não havia revogação de vínculos, não havia limite de um owner
por espaço, e o teste de que a administração familiar não acessa dados
privados não existia. O plano do Supabase e o roteiro de validação real
estão prontos. **Nenhum serviço externo foi criado ou ativado. A fundação
ainda não está validada de ponta a ponta.**

## Arquivos inspecionados

- Git: `git status`, `git log` (4 commits da Fase 1, árvore limpa). A cópia
  na pasta compartilhada só diferia em `public/favicon.svg`, que a pasta
  compartilhada altera ao gravar (metadados de proveniência), sem mudança
  de conteúdo visual.
- Documentação: `README.md`, `docs/arquitetura.md`, `decisoes.md`,
  `seguranca.md`, `banco-de-dados.md`, `ambientes.md`, `testes.md`,
  `pendencias.md`, `relatorio-fase-1.md`.
- Banco: `supabase/migrations/20261020000100_foundation.sql`,
  `20261020000200_households.sql`, `supabase/tests/households.test.ts`,
  `helpers.ts`, `local-supabase-shim.sql`, `scripts/test-db.sh`.
- Contratos: `src/services/auth.ts`, `src/services/supabase.ts`,
  `src/features/auth/*`, `src/features/households/*`, `src/config/env.ts`,
  `src/lib/errors.ts`, `.gitignore`, `.env.example`, `package.json`.

## Arquivos criados ou modificados

| Arquivo | Tipo | Finalidade |
| --- | --- | --- |
| `supabase/migrations/20261020000300_membership_revocation.sql` | novo | RPC `remove_household_member`, owner único, comentário de D14 |
| `supabase/tests/membership.test.ts` | novo | 28 testes de D04/D05 e revogação |
| `supabase/tests/households.test.ts` | modificado | +2 testes de privilégios globais (`anon`, escrita direta) |
| `scripts/e2e/validar-supabase.ts` | novo | roteiro executável dos Testes 1–6 via API (`npm run e2e:supabase`) |
| `supabase/e2e/seed-familia.sql`, `limpar-e2e.sql` | novos | preparação e limpeza de dados fictícios no projeto de desenvolvimento |
| `src/lib/errors.ts`, `errors.test.ts` | modificados | `PGRST303` (token expirado) tratado como sessão expirada |
| `package.json`, `tsconfig.node.json` | modificados | script `e2e:supabase`; typecheck do script |
| `docs/decisoes.md` | modificado | D04 e D05 aprovadas (texto integral), D14–D16 |
| `docs/supabase-plano.md`, `docs/roteiro-validacao.md` | novos | Etapas C e E |
| `docs/seguranca.md` | modificado | revisão da Etapa D com evidências e itens não verificados |
| `docs/banco-de-dados.md`, `testes.md`, `pendencias.md`, `arquitetura.md`, `README.md` | modificados | estado atual |

Commits desta etapa: `9ab2574` (revogação e owner único), `0ab81e1`
(testes de privilégio), `48cee6d` (roteiro E2E), `4d7933d` (documentação) e
o commit deste relatório.

## Como D04 e D05 foram refletidas

| Regra aprovada | Situação encontrada | Situação atual |
| --- | --- | --- |
| Dados privados separados dos familiares | modelo `personal`/`family` já existia | mantido; documentado como aprovado |
| Administração familiar sem acesso a dados privados | correto por construção, **sem teste** | testado para os 4 papéis (ver, listar membros, alterar, administrar) |
| Compartilhamento revogável | **não existia revogação** | RPC `remove_household_member`; acesso some na requisição seguinte, inclusive em sessão aberta |
| owner controla o espaço | owner/admin alteravam nome e fuso; nada mais existia | mantido; **no máximo um owner** (novo índice); owner não pode sair sem transferência |
| admin administra membros | não havia administração de membros | admin remove member/viewer; não remove owner nem outro admin (D15) |
| member/viewer limitados | não alteravam o espaço (testado) | também não removem ninguém; podem sair |
| Papel sozinho não concede acesso a dados não compartilhados | não há dados financeiros ainda | regra registrada como D14 e no comentário da função no banco; obrigatória para os próximos módulos |
| Usuário sem vínculo | sem acesso (testado) | recebe recusa genérica também nas RPCs administrativas, sem revelar se o espaço existe |

## Problemas encontrados e correções

1. Ausência de revogação de vínculo → RPC nova com regras por papel e
   auditoria (testada; teste por mutação confirmou que liberar admin a
   remover owner/admin faz 2 testes falharem).
2. Possibilidade de mais de um owner → índice único parcial (testado).
3. Falta de teste para "admin familiar não vê dados privados" → 6 testes.
4. Token expirado (`PGRST303`) aparecia como erro genérico → mensagem de
   sessão expirada (testado).
5. Script E2E: o `tsconfig` de Node não conhecia `import.meta.env` usado
   por `env.ts` → tipos `vite/client` adicionados.

Achados que não foram alterados (registrados como pendência): perfis
(nome de exibição e fuso) visíveis a co-membros; exclusão de conta bloqueada
para quem criou espaços (`on delete restrict`); recuperação de senha não
implementada.

## Comandos executados e resultados (versão final, após `npm ci` limpo)

| Comando | Resultado |
| --- | --- |
| `npm ci` | instalado, 0 vulnerabilidades |
| `npm run typecheck` | sem erros |
| `npm run lint` | sem erros nem avisos |
| `npm test` | 9 arquivos, **60 testes aprovados** (eram 59; +1 de sessão expirada) |
| `npm run build` | build gerado; aviso de bundle > 500 kB (já conhecido) |
| `npm run check` | aprovado (os quatro acima em sequência) |
| `npm run test:db` | 3 migrações aplicadas em PostgreSQL 16.15 efêmero; 2 arquivos, **60 testes aprovados** (eram 30) |
| `npm audit` | 0 vulnerabilidades |
| `npm run e2e:supabase` sem variáveis | recusa iniciar (variável ausente) |
| idem com chave `sb_secret_…` fictícia | recusa a chave privilegiada |
| idem contra endereço inexistente | falha controlada, código de saída 2; **não executado contra Supabase real** |

## Estado atual das migrações e testes

- Migrações 0001, 0002 e 0003: aplicadas e testadas **somente** em
  PostgreSQL local efêmero. Nunca aplicadas em serviço externo.
- Frontend: 60 testes aprovados. Banco: 60 testes aprovados.
- Validação real (Testes 1–6) preparada, **não executada**.

## Plano proposto para o Supabase

Detalhado em `docs/supabase-plano.md`. Em resumo: projeto
`financas-em-familia-dev`, plano Free, região South America (São Paulo,
`sa-east-1`), somente Auth por e-mail com cadastro desligado, Data API
expondo só `public`, cinco usuários fictícios criados já confirmados,
migrações aplicadas pela CLI com `--dry-run` antes, validação com
`npm run e2e:supabase` e roteiro manual, e procedimento de pausa, limpeza e
exclusão.

## Custos, limites e riscos pendentes de confirmação

O site da Supabase está bloqueado pela rede deste ambiente; os dados vieram
do código-fonte público do site e da documentação no GitHub (2026-10-20) e
devem ser reconfirmados no painel:

- Free: US$ 0; 2 projetos ativos; pausa após 1 semana sem uso; 500 MB de
  banco; 5 GB de egress; 50.000 usuários ativos/mês; 1 GB de arquivos.
- Sem backup automático no Free; sem PITR; sem proteção contra senhas
  vazadas (Pro ou superior).
- SMTP embutido só entrega a membros da equipe, 2 e-mails/hora.
- Pendentes: disponibilidade de `sa-east-1` no Free, janela de restauração
  de projeto pausado (1 ano no texto, 90 dias em imagem), aceitação do
  domínio `exemplo.test`, preço em reais e impostos, comportamento ao
  exceder limites, custo de MFA por telefone.
- Custo só existiria com upgrade de plano ou add-ons, que não devem ser
  feitos sem autorização.

## Ações que exigem autorização posterior

1. Criar o projeto Supabase de desenvolvimento no plano Free (ou conectar
   um existente).
2. Aplicar as migrações 0001–0003 nesse projeto.
3. Criar os cinco usuários fictícios e executar o seed.
4. Executar `npm run e2e:supabase` e o roteiro manual contra o projeto.
5. Limpar dados de teste (`limpar-e2e.sql`), pausar ou excluir o projeto.
6. Publicar o repositório em remoto (GitHub) e configurar CI.
7. Qualquer upgrade de plano ou add-on pago.

## Próximo passo

**Solicitar sua confirmação para criar ou conectar o projeto Supabase de
desenvolvimento** (plano Free, região São Paulo, nome
`financas-em-familia-dev`) e então executar o roteiro de validação real.
Contas e Saldos não foi iniciado e continua aguardando a validação da
fundação.
