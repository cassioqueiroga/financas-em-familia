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
- **Banco (PostgreSQL real)**: perfis, RLS por espaço e papel, privilégios
  por coluna, acesso anônimo negado, RPC transacional, idempotência
  sequencial e concorrente, concorrência otimista, espaço pessoal com membro
  único, auditoria somente inclusão, convenções (sem float, RLS em tudo,
  `search_path` fixo, `money_cents` bigint).

Os testes foram checados por mutação: desligar a política RLS, remover a
idempotência no banco ou na UI faz os testes correspondentes falharem.

## Não coberto (e por quê)

- Fluxo real de autenticação e chamadas ao Supabase: não há projeto
  Supabase configurado (ver `docs/pendencias.md`). A UI é testada com
  dublês dos contratos, que não representam persistência.
- Testes ponta a ponta em navegador no CI: não há CI configurado. Houve
  verificação manual com Chromium headless (ver relatório).
