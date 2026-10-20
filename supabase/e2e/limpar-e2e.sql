-- =============================================================================
-- LIMPEZA DOS DADOS DE TESTE — SOMENTE projeto de DESENVOLVIMENTO.
-- Operação destrutiva: executar apenas com autorização, no projeto de
-- desenvolvimento, e conferir o resultado do SELECT antes do DELETE.
-- Remove espaços criados pelos usuários e2e-*@exemplo.test (membros caem por
-- cascata). A auditoria é somente inclusão e preserva os eventos.
-- Os usuários de teste devem ser removidos em Authentication > Users.
-- =============================================================================
select h.id, h.name, h.kind
from public.households h
join auth.users u on u.id = h.created_by
where u.email like 'e2e-%@exemplo.test';

-- Após conferir a lista acima, remova o comentário e execute:
-- delete from public.households h
-- using auth.users u
-- where u.id = h.created_by and u.email like 'e2e-%@exemplo.test';
