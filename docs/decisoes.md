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

## D04 — Espaços pessoais e familiares (APROVADA em 2026-10-20)
Decisão aprovada pelo responsável: separação entre espaços pessoais e
familiares. Cada usuário mantém seus dados privados. Os dados familiares são
compartilhados explicitamente, com permissões específicas e revogáveis. A
administração familiar não concede acesso automático aos registros privados
dos participantes.

Implementação:
- Todo dado financeiro futuro pertencerá a um espaço (`households`).
  `personal` = dados privados do usuário (um único membro, garantido por
  gatilho); `family` = dados compartilhados.
- O acesso a um espaço exige vínculo em `household_members`; ser owner/admin
  de uma família não dá vínculo nem acesso ao espaço pessoal de ninguém
  (testado em `supabase/tests/membership.test.ts`).
- Revogação: `remove_household_member` apaga o vínculo; como o acesso é
  verificado a cada consulta, vale imediatamente (testado, inclusive em
  sessão já aberta).
- Perfis: co-membros de um espaço veem o perfil uns dos outros (nome de
  exibição e fuso), identificação mínima necessária para a família. Não há
  dado financeiro em perfis.

## D05 — Papéis de acesso (APROVADA em 2026-10-20)
Decisão aprovada pelo responsável:
- `owner`: controla o espaço e suas configurações, sem acesso automático aos
  dados privados dos demais usuários.
- `admin`: administra membros e configurações autorizadas, sem acesso
  automático aos dados privados.
- `member`: utiliza os recursos compartilhados conforme as permissões
  concedidas.
- `viewer`: consulta somente os dados compartilhados aos quais possui acesso.
- O papel, isoladamente, não concede acesso a dados que não tenham sido
  compartilhados ou autorizados.

Implementação atual (ver também D14 e D15):
- Ver o espaço e a lista de membros: todos os papéis.
- Alterar configurações (nome, fuso): owner e admin. Tipo, moeda e criador
  não são alteráveis por ninguém pela API.
- Remover membros: ver D15.
- No máximo um owner por espaço (índice único).
- Excluir espaço, transferir propriedade, convidar e alterar papel: não
  existem ainda (fase de compartilhamento).

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

## D14 — Papel é teto, compartilhamento é concessão (aceita, decorre de D05)
`app_private.has_household_role` verifica apenas vínculo e papel mínimo. As
políticas de dados financeiros futuros devem exigir **as duas coisas**:
papel suficiente E concessão explícita do recurso (ex.: tabela de
compartilhamentos por conta/categoria). Isso está registrado como comentário
da função no banco (migração 0003). Hoje não há tabelas financeiras, então
não existe dado que um papel exponha indevidamente.

## D15 — Regras de remoção de membros (aceita como padrão; revisável)
Padrão conservador escolhido para cumprir "admin administra membros":
owner remove admin/member/viewer; admin remove member/viewer (não remove
outro admin nem o owner); qualquer membro pode sair, exceto o owner (não há
transferência de propriedade). Quem não é membro recebe recusa genérica.
Toda remoção vai para a auditoria.

## D16 — Validação real por script com chave publicável (aceita)
`npm run e2e:supabase` executa os testes 1 a 6 via API, como um cliente
real, sem chave privilegiada. A preparação de papéis usa SQL no painel
(`supabase/e2e/seed-familia.sql`) porque ainda não há fluxo de convite.
