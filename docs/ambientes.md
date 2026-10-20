# Ambientes e variáveis

| Ambiente | `VITE_APP_ENV` | Arquivo local | Observações |
| --- | --- | --- | --- |
| Desenvolvimento | `development` | `.env.local` | Projeto Supabase de desenvolvimento ou stack local. Faixa de aviso visível. |
| Homologação | `staging` | `.env.staging.local` (`npm run build:staging`) | Projeto Supabase separado. Exige HTTPS. Faixa de aviso visível. |
| Produção | `production` | variáveis no provedor de hospedagem | Projeto Supabase separado. Exige HTTPS. |

Cada ambiente deve usar **um projeto Supabase diferente**. Ambientes de
desenvolvimento e homologação nunca devem receber dados financeiros reais.

## Variáveis do frontend (públicas)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `VITE_APP_ENV` | sim | `development`, `staging` ou `production` |
| `VITE_SUPABASE_URL` | sim | URL do projeto. Fora de `development` precisa ser `https://` |
| `VITE_SUPABASE_ANON_KEY` | sim | Chave publicável (`anon` JWT ou `sb_publishable_...`) |

Toda variável `VITE_*` é embutida no JavaScript e portanto **pública**. A
validação (`src/config/env.ts`) roda na inicialização e:

- aponta variáveis ausentes/invalidas na tela "Configuração incompleta", sem
  exibir valores;
- recusa chaves privilegiadas (`service_role` em JWT ou prefixo `sb_secret_`).

## Variáveis de servidor/CI (futuras, nunca no frontend)

Não são usadas pelo código atual; documentadas para quando migrações forem
aplicadas por CI ou funções de servidor existirem.

| Variável | Uso |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI (`supabase link`, `db push`) |
| `SUPABASE_DB_PASSWORD` | senha do banco para a CLI |
| `SUPABASE_PROJECT_REF` | identificador do projeto alvo |
| `SUPABASE_SERVICE_ROLE_KEY` | somente em funções de servidor; ignora RLS |

Arquivos `.env*` (exceto `.env.example`) estão no `.gitignore`.
