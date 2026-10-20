# Limitações, bloqueios e pendências

## Bloqueios (precisam de ação do responsável)

1. **Projeto Supabase de desenvolvimento**: não existe. Sem ele não há login
   real nem persistência ponta a ponta. Plano pronto em
   `docs/supabase-plano.md`; roteiro em `docs/roteiro-validacao.md`.
   Necessário: autorização para criar o projeto no plano Free (ou conectar
   um existente).
2. **Repositório remoto**: o Git é apenas local. Publicar no GitHub exige
   autorização e definição do repositório.

D04 e D05 foram aprovadas em 2026-10-20 e estão refletidas no código.

## Pendências técnicas

- Aplicar migrações em um projeto Supabase e rodar os advisors de segurança.
- Testes ponta a ponta (login real, RLS via PostgREST) quando houver projeto.
- CI (typecheck, lint, testes, build, `test:db`) — depende do repositório remoto.
- Cabeçalhos de segurança (CSP, HSTS) — dependem da hospedagem.
- Configuração de Auth no Supabase: confirmação de e-mail, política de senha,
  limite de tentativas, MFA, URLs de redirecionamento.
- Fluxos de cadastro e recuperação de senha na interface.
- Convites, inclusão de membros, alteração de papel e transferência de
  propriedade (fase de compartilhamento). Hoje a preparação de papéis para
  teste é feita por SQL no painel.
- Concessão explícita de compartilhamento por recurso (D14) — junto com o
  primeiro módulo que tiver dados familiares.
- Política de exclusão de conta quando o usuário é criador de espaços
  (`created_by` com `on delete restrict`).
- Confirmar no fornecedor os itens marcados como pendentes em
  `docs/supabase-plano.md` (região no Free, janela de restauração, domínio
  de e-mail de teste, custos em reais).
- Ensaio do procedimento de restauração de backup.
- Divisão do bundle (566 kB, 164 kB gzip) quando houver mais rotas.
- `supabase/config.toml` para stack local completa (requer Supabase CLI + Docker).

## Fora do escopo desta fase (não iniciado)

Contas e saldos, lançamentos, transferências, cartões/faturas/parcelamentos,
orçamentos, metas, relatórios, importação, convites/compartilhamento, IA,
planos, pagamentos, administração.
