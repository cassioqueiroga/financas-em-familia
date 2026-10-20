# Relatório — Fase 1.2: Revisão final do plano Supabase

Data: 2026-10-20. Projeto: `/mnt/project-files/financas-em-familia` (Git
local, branch `main`, **sem remoto**). Etapa exclusivamente de análise e
documentação.

## A. Resumo executivo

**Situação atual.** A fundação está pronta e testada localmente, e o plano
para o Supabase de desenvolvimento foi revisado. Nenhum projeto Supabase
foi criado, conectado ou configurado, nenhuma migração foi aplicada fora do
PostgreSQL local, nenhum usuário foi criado e nenhum custo foi gerado.

**O que está pronto.**
- Três migrações com RLS, RPCs de criação idempotente e de revogação,
  owner único e auditoria (60 testes de banco aprovados localmente).
- Frontend com validação de configuração que recusa chaves privilegiadas
  (60 testes aprovados; typecheck, lint e build aprovados).
- Plano revisado (`docs/supabase-plano.md`), roteiro de validação real
  (`docs/roteiro-validacao.md`), script `npm run e2e:supabase`, seed e
  limpeza de dados fictícios.

**O que ainda não foi validado.** Tudo que depende do ambiente real: login
pelo Supabase Auth, RLS e RPCs via Data API, persistência ponta a ponta,
revogação e idempotência no serviço real, advisors de segurança,
configurações de Auth e o comportamento do plano Free. **A fundação não está
validada de ponta a ponta.**

## B. Quadro de confirmação

| Item | Situação | Impacto | Ação necessária |
| --- | --- | --- | --- |
| Nome `financas-em-familia-dev` | depende de autorização | identificação do ambiente | aprovar ou indicar outro |
| Plano Free | depende de autorização | custo zero se não houver upgrade | aprovar |
| Região São Paulo (`sa-east-1`) | pendente | latência e localização dos dados | confirmar disponibilidade no Free na tela de criação |
| Projetos ativos disponíveis (limite de 2 no Free) | pendente | pode impedir a criação | conferir quantos projetos a organização já tem |
| Migrações 0001–0003 | confirmado (local) | base do isolamento | aplicar após autorização com `--dry-run` antes |
| Compatibilidade com o novo padrão de privilégios da Supabase | confirmado (local) | evita tabelas expostas sem querer | nenhuma; 60 testes passam com e sem privilégios automáticos |
| RLS em todas as tabelas de `public` | confirmado (local) | isolamento | revalidar no ambiente real (Parte A2) |
| D04: separação pessoal/familiar e admin sem acesso a dados privados | confirmado (local) | privacidade | revalidar via API (Teste 4) |
| D05: papéis e revogação | confirmado (local) | permissões | revalidar via API (Testes 4 e 5) |
| Nenhuma chave privilegiada no frontend | confirmado (código e build) | segurança | usar só a chave publicável no `.env.local` |
| Somente dados fictícios | confirmado (scripts e seed usam `@exemplo.test`) | privacidade | não cadastrar dados reais |
| Seed e limpeza | confirmado (local) | preparação do Teste 4 | executados em PostgreSQL local: seed idempotente, restaura o viewer; limpeza só lista |
| Script E2E | parcialmente confirmado | validação automática | executado só contra endereço inexistente; executar contra o projeto após autorização |
| `supabase init` antes de `link` | corrigido no plano | sem ele o `link` falha | incluído na sequência |
| "Allow new users to sign up" desligado | documentado, não verificado | impede cadastros indevidos | desligar no painel |
| "Auto Confirm User" ao criar usuário | pendente | o SMTP do Free só envia para a equipe | confirmar no painel |
| Domínio `exemplo.test` aceito | pendente | criação dos usuários de teste | confirmar; se recusado, usar outro domínio fictício via `E2E_EMAIL_*` |
| Esquemas expostos na Data API | pendente | `app_private` não pode ser exposto | conferir que só `public` está exposto |
| Janela de restauração após pausa | pendente (fontes divergem) | perda do ambiente se não restaurado | planejar com 90 dias |
| Método de execução (painel + CLI ou conector Supabase disponível nesta sessão) | depende de autorização | quem executa e com quais credenciais | escolher |

## C. Custos e riscos

**Limites do Free a reconfirmar** (fonte: código-fonte público do site e da
documentação da Supabase; o site está bloqueado na rede deste ambiente):
US$ 0/mês; 2 projetos ativos; pausa após 1 semana de baixa atividade;
500 MB de banco, CPU compartilhada e 500 MB de RAM; 5 GB de egress (+5 GB em
cache); 50.000 usuários ativos/mês; 1 GB de arquivos; suporte da
comunidade; SMTP embutido só para membros da equipe, 2 e-mails/hora.

**Sem backups automáticos.** A documentação cita backups diários apenas
para Pro, Team e Enterprise e recomenda `supabase db dump` regular no Free.
Sem PITR. Aceitável porque o ambiente terá só dados fictícios.

**Pausa por inatividade.** Ocorre após cerca de 7 dias de baixa atividade,
com aviso por e-mail. Restauração pelo painel por 90 dias (uma página cita
1 ano). Evitar a pausa exige upgrade para Pro, que **não está autorizado**.

**Recursos pagos que devem permanecer desativados.** Upgrade de plano,
add-ons de computação, PITR, proteção contra senhas vazadas (só Pro ou
superior), log drains, SMS/MFA por telefone (custo não confirmado), domínio
personalizado e qualquer recurso que peça cartão.

**Outras pendências.** Recuperação de senha e cadastro não existem na
interface. Cabeçalhos de segurança dependem da hospedagem. A exclusão de
conta fica bloqueada para quem criou espaços (`on delete restrict`). Os
preços em reais, os impostos e o comportamento ao exceder limites no Free
não foram confirmados. Há um conector Supabase disponível nesta sessão. Ele
foi usado apenas para consultar a documentação pública, sem acessar a conta
nem projetos.

## D. Checklist pré-criação (conferir na interface do fornecedor)

1. A organização está no plano **Free** e tem vaga para mais um projeto ativo.
2. A região **South America (São Paulo)** aparece para o plano Free.
3. Nenhum campo da criação pede cartão ou habilita algo pago.
4. A senha do banco gerada é forte e vai direto para um gerenciador de senhas.
5. As opções de Data API mantêm o Data API ligado, com exposição apenas de `public`.
6. Em Authentication é possível desligar **Allow new users to sign up**.
7. Em Authentication > Users > Add user existe **Auto Confirm User**.
8. Em Settings > API Keys existe a chave **publicável** (`sb_publishable_...`).
9. A página de preços confirma os limites do Free listados na seção C.
10. Os textos sobre pausa e restauração confirmam 7 dias e 90 dias.

## E. Próxima execução (somente após autorização)

Sequência:

1. Criar o projeto `financas-em-familia-dev` (Free, São Paulo) pelo painel,
   ou pelo conector Supabase se você preferir que eu execute.
2. Configurar o Auth: cadastro desligado, senha mínima de 12, URLs `localhost`.
3. `npx supabase@2.119.0 init`, `login` e `link`, depois
   `db push --dry-run` (deve listar só 0001–0003), `db push` e `migration list`.
4. Executar os Advisors (Parte A2) e registrar os alertas.
5. Criar os cinco usuários fictícios confirmados e executar `seed-familia.sql`.
6. Executar `npm run e2e:supabase` (Testes 1–6) e reexecutar o seed.
7. Executar o roteiro manual da interface (Parte B, 7 passos).
8. Executar a regressão local (Parte C) e `npm audit`.
9. Registrar as evidências num relatório de validação, sem segredos.
10. Por decisão sua: manter, pausar ou limpar e excluir o ambiente.

Critérios objetivos para aprovar a fundação:

- `db push --dry-run` lista exatamente as três migrações e `migration list`
  mostra local e remoto iguais.
- Todas as verificações de `npm run e2e:supabase` com `PASSOU` e código de
  saída 0.
- Advisors sem alertas críticos ou "error"; RLS `true` nas três tabelas;
  `anon` sem EXECUTE nas RPCs.
- Os 7 passos manuais com o resultado descrito em `docs/roteiro-validacao.md`.
- `npm run check`, `npm run test:db` e `npm audit` aprovados.
- Nenhum dado real e nenhuma chave privilegiada usados.

Condições que impedem o início de Contas e Saldos:

- Qualquer critério acima não comprovado com evidência real.
- Qualquer verificação de isolamento, permissão, revogação ou idempotência
  com `FALHOU`.
- Alerta crítico de segurança sem correção.
- Divergência entre as migrações locais e as remotas.
- Falta de autorização explícita sua para iniciar o módulo.

## F. Estado do repositório

**Arquivos inspecionados:** `docs/supabase-plano.md`, `roteiro-validacao.md`,
`decisoes.md`, `seguranca.md`, `pendencias.md`, `relatorio-fase-1.md` e
`relatorio-fase-1-1.md`; `scripts/e2e/validar-supabase.ts`; `package.json`;
`supabase/e2e/seed-familia.sql`, `limpar-e2e.sql`;
`supabase/tests/local-supabase-shim.sql`; as três migrações; `.gitignore`.

**Arquivos alterados (somente documentação):**
- `docs/supabase-plano.md`: legenda de confiabilidade, `supabase init`, CLI
  fixada, comandos proibidos, 90 dias, compatibilidade de privilégios e
  nomes das opções do painel.
- `docs/roteiro-validacao.md`: requisitos do script e a nova Parte A2
  (Advisors e consultas de verificação).
- `docs/relatorio-fase-1-2.md`: este relatório.

**Comandos realmente executados:**

| Comando | Resultado |
| --- | --- |
| `git status` e `git log` (cópia de trabalho e pasta compartilhada) | árvore limpa em `d2b84bf`, sem remoto. Única diferença na pasta compartilhada: `public/favicon.svg`, alterado pelo próprio armazenamento |
| Busca na documentação oficial (conector, somente leitura de docs) | `init` obrigatório antes de `link`; restauração em 90 dias; padrão de privilégios em mudança; "Allow new users to sign up" |
| Leitura de docs e do registro npm (GitHub raw, npm) | CLI `supabase@2.119.0` publicada em 2026-09-30 |
| `npm run test:db` com o shim **sem** privilégios automáticos (alteração temporária, revertida) | 2 arquivos, 60 testes aprovados |
| PostgreSQL local: migrações + consultas da Parte A2 | `anon` sem EXECUTE (`f`); RLS `t` nas 3 tabelas |
| PostgreSQL local: seed sem usuários | recusa com mensagem clara |
| PostgreSQL local: 5 usuários fictícios, seed 2× com remoção do viewer entre as execuções | 1 espaço, papéis owner/admin/member/viewer restaurados |
| PostgreSQL local: `limpar-e2e.sql` | apenas lista o espaço de teste (o DELETE continua comentado) |
| `npm run check` | aprovado: typecheck, lint, 9 arquivos/60 testes, build |
| `npm run test:db` | 3 migrações aplicadas; 2 arquivos/60 testes aprovados |
| `npm audit` | 0 vulnerabilidades |

Nenhum comando foi executado contra serviço externo do Supabase.

**Estado do Git ao finalizar:** um commit novo de documentação sobre
`d2b84bf`, árvore limpa, sem remoto configurado e sem push.

## Pedido de autorização

Peço sua autorização explícita para a próxima ação: **criar ou conectar o
projeto Supabase de desenvolvimento `financas-em-familia-dev` no plano Free,
região São Paulo**, depois de você conferir no painel os itens da seção D.
Junto com a autorização, indique o método:

1. Você cria pelo painel e eu aplico as migrações e executo a validação.
2. Eu crio e executo tudo pelo conector Supabase desta sessão.

Até lá nada será criado. Contas e Saldos continua bloqueado até a fundação
ser validada de ponta a ponta com evidências reais.
