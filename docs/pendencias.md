# Limitações, bloqueios e pendências

Atualizado em 2026-10-26 (finalização do núcleo financeiro do casal).

## Bloqueios (precisam de decisão ou ação do proprietário)

1. **Projeto Supabase**: não existe. Sem ele não há uso real; hoje o app roda
   com o backend local de desenvolvimento (D17). Passos em `docs/uso-real.md`
   e `docs/supabase-plano.md`.
2. **Hospedagem**: não definida. Necessária para usar no celular com HTTPS.
3. **Repositório remoto (GitHub privado)**: o Git é apenas local.
4. **Autorização de commits**: o trabalho de 2026-10-26 está fora de commit.
5. **Fonte bancária automática (MeuPluggy/Open Finance)**: bloqueada até
   confirmar viabilidade, limites e custos, autorização explícita e
   credenciais apenas no servidor. Substituto atual: importação OFX/CSV.
6. **Bancos e cartões usados pelo casal**: para conferir o formato real dos
   extratos de cada banco (os testes usam arquivos fictícios).

## Pendências técnicas

- Aplicar as migrações em um projeto Supabase e rodar os advisors de segurança.
- Rodar `npm run e2e:supabase` e `npm run e2e:navegador` contra o projeto real
  de desenvolvimento (hoje validados só no backend local).
- CI (typecheck, lint, testes, build, `test:db`) — depende do repositório remoto.
- Cabeçalhos de segurança (CSP, HSTS) — dependem da hospedagem.
- Configuração de Auth no Supabase: política de senha, limite de tentativas,
  MFA, URLs de redirecionamento.
- Recuperação de senha e troca de senha na interface (hoje: pelo painel do Supabase).
- Alteração de papel e transferência de propriedade do espaço.
- Política de exclusão de conta quando o usuário é criador de espaços
  (`created_by` com `on delete restrict`).
- Edição de compra de cartão (hoje: estornar e lançar de novo) e de
  transferência (hoje: cancelar e lançar de novo).
- Atribuir pessoa e categoria às linhas importadas antes de confirmar (hoje
  entram sem categoria e sem pessoa; dá para corrigir depois).
- Ensaio do procedimento de restauração de backup.
- Divisão do bundle (≈ 640 kB sem compressão) por rota.
- `supabase/config.toml` para stack local completa (requer Supabase CLI + Docker).

## Não iniciado (fora do núcleo; nenhum depende de serviço pago, mas ficou para depois)

Metas, orçamentos por categoria, reserva de emergência, controle de
assinaturas/recorrências automáticas, relatórios por período longo,
exportação, IA (exige decisão: nenhuma API paga foi conectada e nenhum dado
financeiro é enviado a terceiros).
