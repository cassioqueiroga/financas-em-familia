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

## D17 — Backend local de desenvolvimento (aceita, 2026-10-26)
Sem projeto Supabase autorizado e sem acesso à stack oficial (Docker/CLI)
neste ambiente, `scripts/dev-backend/` sobe um PostgreSQL 16 local e um
servidor Node que imita apenas o que o app usa do GoTrue (login por senha,
refresh, usuário, logout; cadastro desligado) e do PostgREST (consultas
simples e RPC). Ele aplica **as mesmas migrações** e executa cada pedido com
`set local role authenticated` e as claims do JWT, então RLS, grants e RPCs
são os reais. Recusa `service_role`, escuta só em 127.0.0.1 e aceita CORS só
de localhost. Não substitui a validação em um projeto Supabase de verdade.

## D18 — Compartilhar marcado por padrão no espaço da família (aceita como padrão; revisável)
Ao cadastrar conta no espaço da família, os outros membros aparecem marcados
("pode ver e lançar"). O titular pode desmarcar antes de salvar ou revogar
depois. Sem concessão ninguém além do titular vê a conta (D14).

## D19 — Despesa de cartão conta no mês da fatura (aceita)
No resumo mensal, compras no cartão entram como despesa no mês de
competência da fatura (fechamento), não na data da compra. O pagamento da
fatura é uma transferência entre contas e não conta como nova despesa.

## D20 — Só o titular altera, desativa e compartilha a conta (aceita)
Owner/admin do espaço não alteram nem enxergam contas que não lhes foram
compartilhadas. Remover um membro apaga as concessões dele (gatilho).

## D21 — Correção = cancelar + substituir (aceita)
Nenhum lançamento é apagado. Corrigir cria um novo lançamento com
`replaces_id` apontando para o original, que fica com situação "cancelado".
Transferências e pagamentos de fatura cancelam as duas pontas juntas.

## D22 — Transferência entre espaços (aceita)
É permitido transferir entre uma conta do espaço pessoal e uma do espaço da
família, desde que a pessoa possa lançar nas duas contas.

## D23 — A tela inicial virou o painel financeiro (aceita)
`src/pages/HomePage.tsx` (tela de boas-vindas da Fase 1) foi substituída por
`src/features/finance/DashboardPage.tsx` na rota `/`.

## D24 — "Gasto de" começa preenchido com quem está lançando (aceita, revisável)
Para o resumo "despesas por pessoa" fazer sentido para o casal sem esforço,
lançamentos e compras novos começam atribuídos ao usuário que registra; dá
para trocar para o outro membro ou "Não atribuído". Lançamentos importados de
extrato ficam sem atribuição.

## D25 — Análises sem IA e sem migração (implementada em branch; publicação aguarda o proprietário)
A tela **Análises** (`/analises`, `src/features/insights/`) é derivada só de
`monthly_summary` (um por mês) e `card_statements` (por cartão), sob as mesmas
permissões (security invoker): cada pessoa analisa apenas o que pode ver.
Médias usam só meses fechados, anteriores ao mês escolhido e com movimento.
O diagnóstico é feito por regras fixas, com limites em `THRESHOLDS`
(`analysis.ts`); nenhum dado sai do app. Merge no `main` (que republica o
site) depende de autorização do proprietário.

## D26 a D28 — Pendentes de decisão do proprietário
- D26: orçamentos por categoria e metas (exige migração no Supabase real).
- D27: IA com Claude via Edge Function do Supabase (conta Anthropic, modelo,
  teto de gasto; chave só como segredo do servidor).
- D28: enviar à Anthropic apenas números agregados (sem descrições, nomes de
  conta ou e-mails).
Plano: `financas-em-familia-governanca/PLANO_ANALISES_E_IA.md`.

## D29 — Análises aprofundadas e mês em detalhe (aceita: "pode publicar e ir ajustando")
Modelos pesquisados e adaptados, ainda sem migração e sem IA (`src/features/insights/deep.ts`):
- Índice de saúde financeira 0–100, inspirado no FinHealth Score (Financial
  Health Network): Gastar (poupança média, −10%→0, 20%→100), Reserva
  (meses/6), Dívidas (fatura do próximo mês sobre a receita: ≤10%→100,
  ≥50%→0) e Organização (despesa categorizada e meses com lançamento).
  Faixas: ≥80 saudável, 40–79 em equilíbrio, <40 vulnerável.
- Regra 50-30-20 pelas categorias padrão; categorias criadas pelo casal ficam
  "sem grupo" (escolher o grupo por categoria exigiria migração).
- Despesas recorrentes: mesma descrição normalizada em ≥3 meses, valor ±25%.
- Mês em detalhe: comparação com o mês anterior e o mesmo mês do ano
  anterior, ritmo de gasto acumulado com projeção do fim do mês, destino do
  dinheiro, categorias com participação, maiores despesas, receitas por
  categoria, despesas por pessoa e por dia da semana.
- Cores de gráfico validadas para daltonismo (tokens `--color-chart-*`).

## D30 — Ano até agora (YTD) e filtro por categoria (implementada em branch; publicação aguarda o proprietário)
Pedido: "vamos adicionar um YTD e filtros para categorizar". Sem migração e sem IA
(`src/features/insights/ytd.ts`):
- Aba "Ano até agora": janeiro até o mês escolhido, comparado com os mesmos
  meses do ano anterior (receitas, despesas, resultado, taxa de poupança),
  despesa acumulada mês a mês e tabela de categorias no ano com fatia,
  média por mês e variação. Meses antes do começo do uso do app ficam fora
  das linhas e das médias. Projeção do ano pelo ritmo dos meses fechados.
- Filtro de categorias (uma ou várias, mais "Sem categoria") em todas as abas
  de Análises. Vale só para os números de despesa; receita, resultado, índice
  de saúde, 50-30-20 e diagnóstico seguem com todos os dados, e a tela avisa.
- Escolher o grupo (necessidade/estilo de vida) por categoria virou a D31.

## D31 — Grupo 50-30-20 escolhido por categoria (autorizada pelo proprietário em 27/10/2026: "Sim, pode mudar o banco")
Migração 0008 (`20261027000100_category_budget_group.sql`), só aditiva:
- `categories.budget_group` opcional (`essential` | `lifestyle`), só para
  despesa; `null` = automático (categorias padrão pela regra do app, as
  criadas pelo casal "sem grupo").
- Função nova `set_category_group(categoria, versão, grupo)`, com o mesmo
  controle de permissão e versão de `update_category` (que não mudou).
- Tela Categorias: seletor de grupo em cada categoria de despesa. Regra
  50-30-20, índice de saúde e tabelas de categoria usam o grupo escolhido.
- Ordem de publicação: aplicar `migracao_0008_grupo_categorias.sql` no
  Supabase real ANTES de publicar o app (o app passa a ler a coluna nova).
  Conferência: `conferir.sql` muda de 28 para 29 funções públicas e
  `conferir_0008.sql` deve mostrar 1 · 1 · 0.
