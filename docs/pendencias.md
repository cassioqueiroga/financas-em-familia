# Limitações, bloqueios e pendências

## Bloqueios (precisam de ação do responsável)

1. **Projeto Supabase de desenvolvimento**: não existe. Sem ele não há login
   real nem persistência ponta a ponta. Necessário: autorização para criar
   (plano gratuito disponível; limites e pausa por inatividade se aplicam) ou
   credenciais de um projeto existente (URL + chave publicável; para aplicar
   migrações, token de acesso da CLI fora do repositório).
2. **Repositório remoto**: o Git é apenas local. Publicar no GitHub exige
   autorização e definição do repositório.
3. **Validação de produto** das decisões D04 (espaços pessoal/família) e
   D05 (papéis).

## Pendências técnicas

- Aplicar migrações em um projeto Supabase e rodar os advisors de segurança.
- Testes ponta a ponta (login real, RLS via PostgREST) quando houver projeto.
- CI (typecheck, lint, testes, build, `test:db`) — depende do repositório remoto.
- Cabeçalhos de segurança (CSP, HSTS) — dependem da hospedagem.
- Configuração de Auth no Supabase: confirmação de e-mail, política de senha,
  limite de tentativas, MFA, URLs de redirecionamento.
- Fluxos de cadastro e recuperação de senha na interface.
- Ensaio do procedimento de restauração de backup.
- Divisão do bundle (566 kB, 164 kB gzip) quando houver mais rotas.
- `supabase/config.toml` para stack local completa (requer Supabase CLI + Docker).

## Fora do escopo desta fase (não iniciado)

Contas e saldos, lançamentos, transferências, cartões/faturas/parcelamentos,
orçamentos, metas, relatórios, importação, convites/compartilhamento, IA,
planos, pagamentos, administração.
