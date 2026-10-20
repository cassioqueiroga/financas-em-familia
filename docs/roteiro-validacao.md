# Roteiro de validação real (quando o Supabase de desenvolvimento existir)

Pré-requisitos: projeto criado e configurado conforme
`docs/supabase-plano.md` (itens 4 a 6), migrações 0001–0003 aplicadas,
cinco usuários fictícios criados e `supabase/e2e/seed-familia.sql`
executado. Registre data, commit (`git rev-parse --short HEAD`) e a saída
de cada passo.

## Parte A — automática via API

```bash
export E2E_SUPABASE_URL=https://<ref>.supabase.co
export E2E_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
export E2E_PASSWORD='<senha dos usuários de teste>'   # digitar, não salvar em arquivo versionado
export E2E_CONFIRM_NON_PRODUCTION=sim
npm run e2e:supabase
```

Saída esperada: uma linha `PASSOU`/`FALHOU` por verificação e o total.
Código de saída 0 só se tudo passar. O script cobre:

| Teste | Verificações |
| --- | --- |
| 1 Autenticação | senha errada recusada (`invalid_credentials`); login devolve o usuário; logout encerra a sessão e a API passa a recusar (`42501`); token inválido/expirado recebe 401; falha de conexão identificável |
| 2 Persistência | criação via RPC; espaço disponível em nova sessão (equivale a recarregar) |
| 3 Isolamento | estranho não lista, não consulta por id, não vê membros nem perfil, não altera, não insere, não exclui, não usa RPC administrativa; anônimo não lê |
| 4 Permissões | os quatro papéis veem o espaço familiar; só owner/admin alteram; owner/admin/member não veem o espaço pessoal do viewer; owner da família não administra esse espaço pessoal; admin não remove owner; member não remove ninguém |
| 5 Revogação | admin remove o viewer; na mesma sessão o viewer deixa de ver espaço e membros e não executa ações; mantém o próprio espaço pessoal |
| 6 Idempotência | mesma chave devolve o mesmo espaço; mesma chave com outros dados é recusada (`23505`); 5 chamadas concorrentes geram um único espaço |

Após a Parte A, execute de novo `seed-familia.sql` para restaurar o viewer.

Requisitos do script: Node 22 (usa `--experimental-strip-types`; o aviso
`ExperimentalWarning` é esperado) e dependências instaladas com `npm ci`.

## Parte A2 — avisos de segurança do Supabase

1. No painel, abrir **Advisors** > **Security Advisor** e **Performance
   Advisor** e executar a análise.
2. Registrar cada alerta (nome, objeto, nível). Alertas de nível crítico ou
   "error" em `public`/`app_private` bloqueiam a aprovação.
3. Conferir no SQL Editor que todas as tabelas de `public` têm RLS:
   `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';`
4. Conferir que `anon` não executa as RPCs:
   `select has_function_privilege('anon', 'public.create_household(text, public.household_kind, uuid, text)', 'execute');` deve retornar `false`.
5. Conferir as configurações de Auth aplicadas (cadastro desligado, senha
   mínima) e anotar as que não existem no plano Free.

## Parte B — manual na interface

Com `.env.local` apontando para o projeto e `npm run dev`:

1. **Login/logout**: abrir `http://localhost:5173/espacos` sem sessão →
   redireciona para "Entrar". Entrar como `e2e-owner` → volta para
   "Espaços". Clicar "Sair" → volta para "Entrar".
2. **Senha errada**: mensagem "E-mail ou senha incorretos.".
3. **Criação e recarga**: criar o espaço "E2E UI <data>" (tipo Família) →
   mensagem de sucesso e item na lista. Recarregar (F5) → item continua.
   Conferir no Table Editor (`households`) que a linha existe, com
   `created_by` do owner, e em `household_members` o vínculo `owner`.
4. **Duplo envio**: com a rede lenta (DevTools > Network > Slow 3G), clicar
   duas vezes em "Criar espaço" → apenas um registro novo.
5. **Sessão expirada**: em DevTools > Application > Local Storage, apagar a
   chave `sb-<ref>-auth-token` e recarregar → volta para "Entrar".
   Alternativa: alterar o `access_token` salvo para um valor inválido e
   abrir "Espaços" → mensagem de sessão expirada ou retorno a "Entrar".
6. **Erro de conexão**: DevTools > Network > Offline, tentar entrar →
   "Sem conexão com o servidor. Verifique sua internet."
7. **Isolamento na interface**: entrar como `e2e-stranger` → "Você ainda
   não tem espaços".

## Parte C — regressão local (Teste 7)

```bash
npm ci
npm run check      # typecheck + lint + test + build
npm run test:db    # PostgreSQL local efêmero
npm test
npm run build
npm audit
```

## Critérios de aceite

- Parte A: todas as verificações `PASSOU`.
- Parte B: os 7 passos com o resultado descrito.
- Parte C: todos os comandos sem falha; `npm audit` sem vulnerabilidades
  altas/críticas.
- Parte A2: advisors sem alertas críticos e consultas com o resultado esperado.
- Evidências (saídas e capturas) anexadas ao relatório da validação, sem
  senhas, tokens ou chaves.
