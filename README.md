# Finanças em Família

Aplicação web responsiva para organização financeira individual e familiar.

**Estado atual (2026-10-26): núcleo financeiro do casal implementado e testado
localmente**, com banco PostgreSQL real e um backend local de desenvolvimento.
Ainda **não há projeto Supabase nem hospedagem**: o app nunca foi publicado e não
deve receber dados financeiros reais antes disso (ver `docs/uso-real.md`).

## O que existe

- Espaços pessoal e da família; convite da esposa por código de uso único;
  nome de exibição; remoção/saída de membros.
- Contas (corrente, poupança, carteira, cartão de crédito) com saldo inicial,
  ativação/desativação e **compartilhamento por conta** (ver/lançar ou só ver).
  Só quem tem acesso concedido vê a conta, mesmo dentro do espaço da família.
- Categorias padrão (19) e personalizadas.
- Receitas, despesas, contas a pagar/receber (pendentes), efetivação,
  correção (gera novo lançamento e mantém o original cancelado) e cancelamento.
- Transferências entre contas (inclusive entre espaço pessoal e da família).
- Cartões: compras à vista ou parceladas (1–48x, centavos exatos), faturas por
  fechamento/vencimento, pagamento total ou parcial, estorno de compra.
- Painel do mês: saldo disponível, receitas, despesas, resultado,
  compromissos, dívida dos cartões, despesas por categoria e por pessoa,
  pendências e faturas do mês.
- Importação de extratos OFX e CSV no navegador, com pré-visualização,
  detecção de duplicados e possíveis duplicados.
- Toda regra de acesso e de dinheiro fica no banco (RLS + RPCs `security
  definer`, idempotência, concorrência otimista, auditoria). Dinheiro sempre
  em centavos inteiros.

## Requisitos

- Node.js 22 (ver `.nvmrc`) e npm. Para **alterar dependências** use npm ≥ 11
  (`npx npm@11 install ...`): o npm 10.9 tem um bug que impede resolver o
  Vitest 5. `npm ci` funciona com npm 10.
- PostgreSQL 16 (binários `initdb`, `pg_ctl`, `psql`) para `npm run test:db` e `npm run dev:backend`.

## Como executar

### Localmente, sem nuvem (dados fictícios)

```bash
npm ci
npm run dev:backend     # terminal 1: PostgreSQL local + API compatível (127.0.0.1:54321)
npm run dev:local       # terminal 2: http://localhost:5173
```

O backend local cria dois usuários fictícios (`chefe@exemplo.test` e
`esposa@exemplo.test`) com senhas aleatórias gravadas em
`.local-dev/credenciais-de-teste.txt` (fora do Git). `npm run dev:backend -- --reset`
apaga tudo e recomeça. Ele **não é o Supabase**: serve só para desenvolver e testar.

### Com um projeto Supabase

```bash
cp .env.example .env.local   # URL e chave PUBLICÁVEL do Supabase
npm run dev
```

Passo a passo para uso real em `docs/uso-real.md`.

## Validação

```bash
npm run check     # typecheck + lint + testes + build
npm run test:db   # migrações + RLS em PostgreSQL local efêmero
npm run e2e:navegador  # fluxos no navegador (com dev:backend e dev:local rodando)
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
| [docs/uso-real.md](docs/uso-real.md) | Como colocar o app em uso real pelo casal |
| [docs/supabase-plano.md](docs/supabase-plano.md) | Plano do projeto Supabase de desenvolvimento (não criado) |
| [docs/roteiro-validacao.md](docs/roteiro-validacao.md) | Roteiro de validação real (API, interface, regressão) |
| [docs/relatorio-fase-1.md](docs/relatorio-fase-1.md) | Relatório final da Fase 1 |
| [docs/relatorio-fase-1-1.md](docs/relatorio-fase-1-1.md) | Relatório da Fase 1.1 |
