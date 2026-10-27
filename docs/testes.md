# Testes

## Comandos

| Comando | O que faz | Requisitos |
| --- | --- | --- |
| `npm run typecheck` | TypeScript estrito (app, configs e testes de banco) | — |
| `npm run lint` | ESLint (TS, React Hooks, proíbe `console.log`) | — |
| `npm test` | Vitest: unidades e componentes (jsdom) | — |
| `npm run build` | `tsc -b` + build de produção do Vite | — |
| `npm run check` | os quatro acima em sequência | — |
| `npm run test:db` | cria PostgreSQL efêmero, aplica shim + migrações e roda `supabase/tests` | PostgreSQL 16 (`PG_BIN` opcional) |
| `npm run dev:backend` | sobe o backend local (PostgreSQL 16 + API compatível) com usuários fictícios | PostgreSQL 16 |
| `npm run e2e:navegador` | 22 verificações no Chromium contra `npm run dev:local` + `dev:backend` (banco limpo: `-- --reset`) | Playwright/Chromium instalados |
| `npm run e2e:supabase` | validação real via API contra o projeto Supabase de **desenvolvimento** (ver `docs/roteiro-validacao.md`) | projeto Supabase, usuários de teste, variáveis `E2E_*` |

`test:db` nunca se conecta a bancos existentes: usa porta `54329` em
`127.0.0.1` e apaga o cluster ao final (inclusive em falha).

## Cobertura atual

- **Configuração**: variáveis ausentes, ambiente inválido, chave privilegiada
  (JWT e `sb_secret_`), HTTPS fora de dev, não vazamento de valores.
- **Dinheiro**: parsing pt-BR sem float, formatação exata, limites de
  inteiro seguro, rateio que preserva o total (incl. negativos, 1–24 parcelas).
- **Datas**: data de negócio em `America/Sao_Paulo` vs UTC na virada do dia.
- **Erros e logs**: mapeamento seguro, falhas de rede, redação.
- **Componentes**: estados de tela com ARIA; redirecionamento sem sessão;
  login com erro e retorno à rota pedida; espaços vazio/lista/erro com nova
  tentativa; validação; reutilização da chave de idempotência.
- **D04/D05 e revogação** (`membership.test.ts`): nenhum papel familiar vê ou
  administra o espaço pessoal de outro membro; matriz de remoção por papel;
  saída voluntária; owner não sai; recusa genérica para não membros;
  auditoria da remoção; owner único; membro removido perde acesso a espaço,
  membros e perfis, inclusive em sessão já aberta.
- **Banco (PostgreSQL real)**: perfis, RLS por espaço e papel, privilégios
  por coluna, acesso anônimo negado, RPC transacional, idempotência
  sequencial e concorrente, concorrência otimista, espaço pessoal com membro
  único, auditoria somente inclusão, convenções (sem float, RLS em tudo,
  `search_path` fixo, `money_cents` bigint, `anon` sem acesso a funções e
  tabelas, `authenticated` sem INSERT/DELETE direto).

Os testes foram checados por mutação: desligar a política RLS, remover a
idempotência no banco ou na UI, ou permitir que admin remova owner/admin faz
os testes correspondentes falharem.

## Núcleo financeiro (2026-10-26)

- **Banco** (`invitations.test.ts`, `finance.test.ts`,
  `cards-summary-import.test.ts`): convites (uso único, expiração, papéis
  permitidos, hash do código), contas e concessões por conta (titular, viewer
  só lê, owner/admin não veem conta não compartilhada, remoção de membro apaga
  concessões), categorias, lançamentos, efetivação, correção e cancelamento
  com histórico, transferências (inclusive entre espaços), idempotência e
  concorrência otimista, parcelamento em centavos exatos, fechamento e
  vencimento de fatura, pagamento parcial e total, estorno, resumo mensal,
  importação com deduplicação. Grupo 50-30-20 por categoria (D31). Total: 121 testes de banco.
- **Interface** (`pages.test.tsx`): painel vazio e com dados, validações de
  conta, cartão, valor e parcelas, despesa pendente, receita, transferência,
  cancelamento com confirmação, mensagem segura em erro do servidor, compra
  parcelada, pagamento de fatura, pré-visualização e importação OFX, convite.
- **Importação** (`parsers.test.ts`): OFX SGML/XML, CSV com separadores e
  formatos brasileiros, codificação windows-1252, limites de tamanho e linhas.
- **Navegador** (`e2e:navegador`): login (inclusive senha errada), espaço da
  família, convite e aceite pela esposa, código reutilizado recusado, contas,
  lançamentos, correção, cartão parcelado, pagamento de fatura, OFX e
  reimportação, saldo calculado, persistência após recarregar, privacidade de
  conta não compartilhada, despesa da esposa no painel por pessoa, sair.

Checagem por mutação: trocar a política de lançamentos por `using (true)`
fez 5 testes de banco falharem; trocar a regra de fechamento `<` por `<=`
fez 1 falhar.

## Não coberto (e por quê)

- Fluxo real de autenticação e chamadas ao Supabase hospedado: não há
  projeto Supabase configurado (ver `docs/pendencias.md`). O backend local
  (D17) cobre o mesmo banco e as mesmas regras, mas não o GoTrue/PostgREST reais.
  `npm run e2e:supabase` passou (40/40) e `npm run e2e:navegador` (22/22; 31/31 com as Análises, o mês em detalhe, o ano até agora, o filtro por categoria e o grupo por categoria, só no backend local)
  **somente contra o backend local**; nenhum dos dois rodou contra um
  projeto Supabase.
- Testes ponta a ponta em navegador no CI: não há CI configurado.
