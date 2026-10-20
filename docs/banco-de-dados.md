# Banco de dados e persistência

## Estado real (2026-10-20)

- As migrações **foram aplicadas e testadas somente em um PostgreSQL 16.15
  local e efêmero**, criado e destruído por `npm run test:db`.
- **Nenhum projeto Supabase está conectado.** Não há banco de desenvolvimento,
  homologação ou produção. Portanto a persistência da aplicação **não está
  funcional** de ponta a ponta: o frontend tem a integração pronta, mas sem
  `VITE_SUPABASE_URL`/chave válidas as chamadas falham com erro de conexão.

## Convenções

- `snake_case`; tabelas no plural; PK `id uuid default gen_random_uuid()`
  (tabelas de junção usam PK composta).
- Toda tabela de `public` tem RLS habilitado (verificado por teste).
- Tabelas e funções internas ficam no esquema `app_private`, não exposto pela
  API.
- Funções `security definer` sempre com `set search_path = ''` e nomes
  qualificados (verificado por teste).
- Privilégios mínimos: o Supabase concede `ALL` a `anon`/`authenticated` por
  padrão; cada migração revoga e concede somente o necessário, inclusive por
  coluna (`grant update (name, timezone)`).
- Valores monetários: domínio `public.money_cents` (`bigint`, centavos).
  Nenhuma coluna `real`/`double precision` (verificado por teste).
- Moeda: domínio `public.currency_code` (ISO 4217).
- Instantes em `timestamptz`; datas de negócio em `date`, interpretadas no
  `timezone` do espaço (padrão `America/Sao_Paulo`).
- Integridade: FKs explícitas com `on delete` deliberado; `check` para
  formatos e tamanhos; validações duplicadas no frontend apenas por UX.

## Modelo atual

| Tabela | Finalidade |
| --- | --- |
| `public.profiles` | 1:1 com `auth.users`, criado por gatilho; nome de exibição e fuso |
| `public.households` | espaço que isolará os dados financeiros; `kind` = `personal` ou `family` |
| `public.household_members` | vínculo usuário–espaço com papel `owner`/`admin`/`member`/`viewer` |
| `app_private.audit_events` | auditoria somente inclusão (gatilhos bloqueiam update/delete/truncate) |
| `app_private.idempotency_keys` | chaves de idempotência por usuário e operação |

## Transações, concorrência e idempotência

- **Transações**: operações que tocam vários registros são funções RPC
  (uma chamada = uma transação). Ex.: `create_household` cria espaço, membro
  owner, registra a chave de idempotência e o evento de auditoria juntos.
- **Concorrência otimista**: tabelas mutáveis têm `version`, incrementada por
  gatilho. Atualize com `where id = $1 and version = $2`; zero linhas afetadas
  indica conflito (testado).
- **Idempotência**: o cliente gera uma chave UUID por intenção do usuário e a
  reutiliza em novas tentativas. A mesma chave devolve o mesmo recurso; com
  parâmetros diferentes gera erro `23505`. Requisições concorrentes com a
  mesma chave produzem um único registro (testado com 5 chamadas paralelas).
- **Espaço pessoal**: um único membro, garantido por gatilho com `for update`.

## Migrações

Formato do Supabase CLI: `supabase/migrations/<AAAAMMDDHHMMSS>_<nome>.sql`,
aplicadas em ordem lexicográfica, cada uma em transação.

Regras:

1. Migração já aplicada em qualquer ambiente compartilhado **nunca é editada**;
   corrija com nova migração (*forward-only*). As duas migrações atuais ainda
   não foram aplicadas em nenhum ambiente compartilhado.
2. Mudanças destrutivas (drop, alteração de tipo com perda) exigem
   autorização explícita, backup verificado e plano de reversão.
3. Toda migração nova deve passar em `npm run test:db`.

Aplicar em um projeto Supabase (quando autorizado):

```bash
npx supabase link --project-ref <ref>    # requer SUPABASE_ACCESS_TOKEN
npx supabase db push --dry-run           # revisar
npx supabase db push
```

O arquivo `supabase/tests/local-supabase-shim.sql` **não é migração**: ele
recria localmente o que o Supabase já fornece (`auth.users`, `auth.uid()`,
papéis e privilégios padrão) só para os testes.

## Recuperação

- **Backups**: confirmar no plano Supabase escolhido a política de backup
  diário e a disponibilidade de PITR (recuperação a um ponto no tempo; pode
  ser recurso pago, exige autorização).
- **Antes de migração arriscada**: `pg_dump` lógico do esquema e dados
  (`npx supabase db dump`), guardado fora do repositório e sem dados reais em
  ambientes de teste.
- **Falha de migração**: cada arquivo roda em transação; em erro, nada é
  aplicado. Corrigir e reaplicar.
- **Erro lógico após aplicada**: escrever migração corretiva; se houve perda
  de dados, restaurar backup/PITR em projeto separado, validar e só então
  migrar os dados de volta.
- **Ensaio**: o procedimento de restauração deve ser testado em homologação
  antes da primeira publicação (pendente; não há projeto ainda).
