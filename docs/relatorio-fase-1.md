# Relatório final — Fase 1: Fundação Técnica

Data: 2026-10-20. Local do projeto: `/mnt/project-files/financas-em-familia`
(repositório Git local, branch `main`, sem remoto).

**Resumo:** a base técnica está criada, documentada e verificada localmente.
Typecheck, lint, 59 testes de frontend, build e 30 testes de banco em
PostgreSQL real passam. **A persistência não está funcional de ponta a ponta**
porque não existe projeto Supabase configurado; o sistema não está pronto
para produção e não foi publicado.

## A. Diagnóstico inicial

- **Estado encontrado**: pasta compartilhada do projeto vazia; nenhum código,
  repositório Git, documentação ou configuração anterior. Nada a preservar.
- **Ambiente**: Node 22.22.0, npm 10.9.4, pnpm 10.28, Git 2.43, PostgreSQL
  16.15 (binários locais), Docker, acesso ao registro npm.
- **Riscos/limitações identificados**:
  - Sem projeto Supabase, sem credenciais e sem autorização para criar serviço
    externo → integração preparada, não exercitada.
  - npm 10.9.4 falha ao instalar o Vitest 5 (bug do npm) → lockfile gerado
    com npm 11; `npm ci` com npm 10 funciona.
  - TypeScript 7 incompatível com typescript-eslint → TypeScript 6.0.3.
  - Pacotes publicados nos últimos dias → fixadas versões com ≥ 2 semanas.

## B. Alterações realizadas

Todos os arquivos são novos (não havia arquivos a modificar).

| Arquivo(s) | Finalidade |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.db.config.ts`, `eslint.config.js`, `.editorconfig`, `.nvmrc`, `.gitignore`, `index.html`, `public/favicon.svg` | Estrutura, scripts, TypeScript estrito, lint, testes, segredos fora do Git |
| `.env.example` | Variáveis necessárias, sem valores reais |
| `src/config/env.ts` | Validação das variáveis por ambiente; recusa chave privilegiada |
| `src/lib/money.ts`, `dates.ts`, `errors.ts`, `logger.ts` | Centavos exatos, rateio exato, data de negócio com fuso, erros seguros, logs redigidos |
| `src/services/supabase.ts`, `auth.ts` | Cliente Supabase (chave publicável, PKCE) e contrato de autenticação |
| `src/features/auth/*` | Sessão, contexto e proteção de rotas |
| `src/features/households/*` | Espaços: tipos, validação, repositório, página com os quatro estados |
| `src/components/*`, `src/pages/*`, `src/app/*`, `src/index.css`, `src/main.tsx` | Layout responsivo, identidade visual, estados de tela, rotas, composição |
| `src/**/*.test.ts(x)`, `src/test/*` | Testes de unidade e componentes |
| `supabase/migrations/20261020000100_foundation.sql` | Esquema privado, domínios monetários, `version`, auditoria, idempotência |
| `supabase/migrations/20261020000200_households.sql` | Perfis, espaços, membros, RLS, privilégios, RPC `create_household` |
| `supabase/tests/*`, `scripts/test-db.sh` | Testes de integração em PostgreSQL efêmero + shim local do Supabase |
| `README.md`, `docs/*.md` | Documentação técnica obrigatória |

Histórico Git: 4 commits em unidades lógicas (estrutura, banco, frontend,
documentação).

## C. Arquitetura

- SPA React → Supabase (Auth + PostgREST) → PostgreSQL com RLS. Sem servidor
  próprio; autorização no banco. Detalhes em `docs/arquitetura.md`.
- Decisões registradas em `docs/decisoes.md` (D01–D13). Duas exigem
  validação de produto: **D04** (espaços pessoal/família como unidade de
  isolamento) e **D05** (papéis owner/admin/member/viewer).
- Dependências de produção: `react`, `react-dom` (UI), `react-router`
  (navegação), `@supabase/supabase-js` (Auth/API), `zod` (validação).
  Desenvolvimento: Vite, TypeScript, Tailwind, Vitest, Testing Library,
  jsdom, ESLint e `pg` (testes de banco). Nenhuma dependência além do
  necessário para a stack de referência.

## D. Testes

Comandos efetivamente executados na versão final (após `npm ci` limpo):

| Comando | Resultado |
| --- | --- |
| `npm ci` | 273 pacotes, 0 vulnerabilidades |
| `npm run typecheck` | sem erros |
| `npm run lint` | sem erros nem avisos |
| `npm test` | 9 arquivos, **59 testes aprovados** |
| `npm run build` | build gerado (aviso: bundle de 566 kB / 164 kB gzip) |
| `npm run test:db` | 2 migrações aplicadas em PostgreSQL 16.15 efêmero; **30 testes aprovados** |
| `npm audit` | 0 vulnerabilidades |

Verificações adicionais:

- **Navegador real** (Chromium headless via Playwright, servidor `vite`):
  `/espacos` sem sessão redireciona para `/entrar`; login sem Supabase
  disponível mostra "Sem conexão com o servidor"; sem variáveis, o build
  mostra "Configuração incompleta" listando apenas nomes; sem erros de
  JavaScript na página; layout conferido em 390 px e 1280 px.
- **Testes por mutação**: desligar a política RLS de leitura, remover a
  idempotência da RPC ou gerar nova chave a cada tentativa na UI fazem os
  testes correspondentes falharem (1, 3 e 1 falhas, respectivamente).

Falhas encontradas e corrigidas:

1. `npm install` falhava (bug do npm 10.9.4) → lockfile gerado com npm 11.
2. `baseUrl` obsoleto no TypeScript 6 → removido, `paths` relativo.
3. Lint: `setState` síncrono em efeito e exports mistos em arquivos de
   componente → carregamento reestruturado; contextos em arquivos próprios.
4. **Defeito real encontrado pelos testes de banco**: as constraints de fuso
   chamavam uma função sem `EXECUTE` para `authenticated`, bloqueando todo
   `UPDATE` em perfis e espaços → concedido `EXECUTE` (corrigido na própria
   migração, que ainda não foi aplicada em nenhum ambiente).
5. Falha de rede do Supabase Auth aparecia como erro genérico → mapeada para
   "Sem conexão com o servidor" (teste adicionado).

Não executados:

- Autenticação e acesso a dados via Supabase real: não há projeto.
- Testes ponta a ponta automatizados e CI: não há repositório remoto/CI.

## E. Persistência e segurança

- **Estado real do banco**: migrações aplicadas e testadas **somente** em
  PostgreSQL local efêmero. **Nenhuma conexão com Supabase.** O app depende
  de `VITE_SUPABASE_URL` e chave publicável para funcionar.
- **Controles implementados**: RLS em todas as tabelas, isolamento por
  espaço e papel, privilégio mínimo por coluna, `anon` sem acesso, escrita
  via RPC transacional com validação no servidor, idempotência (inclusive
  concorrente), concorrência otimista, auditoria somente inclusão,
  `search_path` fixo, recusa de chave privilegiada no frontend, erros sem
  detalhes técnicos, logs redigidos, segredos fora do Git.
- **Pendentes**: CSP/HSTS na hospedagem; configuração do Auth (senha,
  confirmação, MFA, rate limit); testes ponta a ponta; advisors do Supabase;
  ensaio de restauração. Ver `docs/seguranca.md`.

## F. Pendências

- **Bloqueios**: projeto Supabase de desenvolvimento (criar com autorização
  ou fornecer URL + chave publicável); repositório remoto (autorização).
- **Credenciais necessárias** (nunca no repositório): URL e chave publicável
  por ambiente; `SUPABASE_ACCESS_TOKEN`/senha do banco para aplicar
  migrações via CLI.
- **Riscos conhecidos**: sessão em `localStorage` (mitigar com CSP);
  integração real nunca exercitada; bundle grande.
- **Decisões que exigem avaliação**: D04 e D05.

## G. Próxima etapa

**Recomendação**: conectar um projeto Supabase de desenvolvimento e validar a
fundação de ponta a ponta antes de iniciar o primeiro módulo financeiro
(Contas e saldos).

Pré-requisitos:

1. Autorização para criar um projeto Supabase de desenvolvimento (plano
   gratuito) ou acesso a um existente.
2. Confirmação das decisões D04 e D05.
3. Opcional: repositório GitHub para CI.

Critérios de aceite:

- `npx supabase db push` aplica as duas migrações sem erro; advisors de
  segurança sem alertas críticos.
- Login real com usuário de teste; criar e listar espaços pela interface;
  segundo usuário de teste não vê os espaços do primeiro (verificado pela API).
- Repetir a criação com a mesma chave não duplica (verificado no banco).
- `npm run check` e `npm run test:db` continuam aprovados; CI executando os
  mesmos comandos, se houver repositório.
