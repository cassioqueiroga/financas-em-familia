# Finanças em Família

Aplicação web responsiva para organização financeira individual e familiar.

**Estado atual: Fase 1 — Fundação Técnica.** Não há módulos financeiros
(contas, lançamentos, cartões, orçamentos etc.) implementados. O sistema
**não está pronto para produção** e nunca foi publicado.

## O que existe

- Frontend React + TypeScript + Tailwind com navegação, layout responsivo,
  estados de carregamento/erro/vazio/sucesso e tela de entrada.
- Integração preparada com Supabase Auth e PostgREST (somente chave publicável).
- Migrações PostgreSQL com perfis, espaços (pessoal/família), membros,
  políticas RLS, RPC idempotente, auditoria somente inclusão.
- Primitivas de precisão financeira (centavos inteiros, rateio exato, datas
  com fuso explícito).
- Testes unitários, de componentes e de integração do banco (PostgreSQL real
  local e efêmero).

## Requisitos

- Node.js 22 (ver `.nvmrc`) e npm. Para **alterar dependências** use npm ≥ 11
  (`npx npm@11 install ...`): o npm 10.9 tem um bug que impede resolver o
  Vitest 5. `npm ci` funciona com npm 10.
- PostgreSQL 16 (binários `initdb`, `pg_ctl`, `psql`) apenas para `npm run test:db`.

## Como executar

```bash
npm ci
cp .env.example .env.local   # preencha com URL e chave PUBLICÁVEL do Supabase
npm run dev                  # http://localhost:5173
```

Sem um projeto Supabase configurado o app inicia, mas autenticação e dados
falham com mensagem de erro de conexão. Sem variáveis válidas o app mostra a
tela "Configuração incompleta" (não quebra).

## Validação

```bash
npm run check     # typecheck + lint + testes + build
npm run test:db   # migrações + RLS em PostgreSQL local efêmero
```

Detalhes em [docs/testes.md](docs/testes.md).

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/arquitetura.md](docs/arquitetura.md) | Organização, camadas, inventário de tecnologias |
| [docs/ambientes.md](docs/ambientes.md) | Ambientes e variáveis |
| [docs/banco-de-dados.md](docs/banco-de-dados.md) | Convenções, migrações, concorrência, recuperação |
| [docs/seguranca.md](docs/seguranca.md) | Controles, riscos e mitigações |
| [docs/testes.md](docs/testes.md) | Como testar e o que é coberto |
| [docs/interface.md](docs/interface.md) | Identidade visual e acessibilidade |
| [docs/decisoes.md](docs/decisoes.md) | Registro de decisões técnicas |
| [docs/pendencias.md](docs/pendencias.md) | Limitações, bloqueios e pendências |
| [docs/relatorio-fase-1.md](docs/relatorio-fase-1.md) | Relatório final da Fase 1 |
