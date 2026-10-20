# Registro de decisões técnicas

Formato: contexto → decisão → consequências. Status: **aceita** (técnica,
reversível) ou **a validar** (afeta produto/negócio e precisa de confirmação).

## D01 — Stack de referência (aceita)
React 19 + TypeScript + Vite 8 + Tailwind 4, conforme o prompt mestre. Vite
foi escolhido por ser o padrão atual para SPA React sem servidor próprio.

## D02 — Sem servidor de aplicação na Fase 1 (aceita)
A autorização fica no PostgreSQL (RLS + grants + RPC). Evita uma camada a
mais sem necessidade. Integrações com segredo usarão funções de servidor
quando forem autorizadas.

## D03 — Supabase Auth (aceita, integração não verificada)
Atende ao requisito e integra com RLS via `auth.uid()`. Fluxo PKCE.
Somente login por e-mail/senha foi preparado; cadastro, recuperação de senha
e provedores sociais dependem da configuração do projeto Supabase.

## D04 — Espaços (`households`) como unidade de isolamento (a validar)
Todo dado financeiro futuro pertencerá a um espaço. `personal` = finanças
individuais (um membro); `family` = grupo familiar. Alternativa considerada:
dados "do usuário" e "da família" em tabelas separadas, que duplicaria
regras de acesso. **Precisa de confirmação de produto.**

## D05 — Papéis owner/admin/member/viewer (a validar)
Hierarquia proposta para o compartilhamento familiar. Só owner/admin alteram
o espaço. As permissões de cada papel sobre lançamentos serão definidas na
fase de compartilhamento. **Precisa de confirmação de produto.**

## D06 — Dinheiro em centavos inteiros (aceita)
Banco: `bigint` (domínio `money_cents`). JS: `number` inteiro validado com
`Number.isSafeInteger` (até ~R$ 90 trilhões), formatado via string decimal
exata. `bigint` no JS foi descartado por não serializar em JSON nativamente.

## D07 — Datas com fuso explícito (aceita)
Instantes em `timestamptz`; datas de negócio em `date` no fuso do espaço,
padrão `America/Sao_Paulo`, moeda padrão BRL. Nunca o fuso do navegador.

## D08 — Idempotência por chave do cliente (aceita)
Tabela `app_private.idempotency_keys` + chave UUID por intenção. Padrão a ser
reutilizado por todas as RPCs de escrita financeira.

## D09 — Concorrência otimista por `version` (aceita)
Simples, compatível com PostgREST, detecta edições simultâneas sem locks
longos.

## D10 — Migrações forward-only no formato do Supabase CLI (aceita)
Testadas em PostgreSQL local efêmero com um shim de `auth`. A CLI do
Supabase será usada para aplicar em projetos reais.

## D11 — TypeScript 6.0 em vez de 7.0 (aceita)
O typescript-eslint 8.71 suporta TS < 6.1. Reavaliar quando houver suporte.

## D12 — Versões com pelo menos duas semanas de publicação (aceita)
Reduz risco de pacote comprometido recém-publicado. Versões exatas no
`package.json`.

## D13 — Lockfile gerado com npm 11 (aceita)
O npm 10.9.4 falha (`Cannot read properties of null (reading 'edgesOut')`)
ao resolver as dependências peer opcionais do Vitest 5. `npm ci` com npm 10
funciona a partir do lockfile.
