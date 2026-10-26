# Uso real pelo casal — passo a passo

Este app ainda **não está em uso real**. Hoje ele roda e foi testado só no
computador, com dados fictícios (`npm run dev:backend` + `npm run dev:local`).
Para o casal usar com dados de verdade faltam decisões do proprietário e três
peças de infraestrutura. Nada abaixo foi executado: são os passos previstos.

## O que precisa ser decidido antes

| Decisão | Por que importa |
| --- | --- |
| Criar o projeto Supabase (plano Free) | É onde ficam login e dados. Sem ele não há uso real. |
| Hospedagem do site (ex.: Vercel, Netlify, Cloudflare Pages, plano gratuito) | Para abrir o app no celular fora de casa, com HTTPS. |
| Repositório GitHub privado | Guarda o código fora deste ambiente e permite CI. |
| Autorizar commits | Hoje todo o trabalho está fora de commit. |
| Fonte bancária automática (MeuPluggy/Open Finance) | **Bloqueada** até confirmar viabilidade, limites e custos e haver credenciais só no servidor. A importação OFX/CSV funciona sem isso. |
| Quais contas ficam privadas e quais compartilhadas | O app já permite as duas coisas, conta a conta. |

## 1. Projeto Supabase

Siga `docs/supabase-plano.md` (seções 4 e 5): criar o projeto, desligar o
cadastro público ("Allow new users to sign up"), configurar URLs e aplicar as
**sete** migrações de `supabase/migrations` com `supabase db push` (sempre
`--dry-run` antes). Nunca aplique `supabase/tests/local-supabase-shim.sql`.
Depois rode os Advisors de segurança do painel e registre o resultado.

## 2. Usuários (só vocês dois)

1. No painel: Authentication > Users > Add user, criar um usuário para cada
   um, já confirmado, com senha forte e diferente.
2. Com o cadastro público desligado, ninguém mais consegue criar conta.

## 3. Primeiro acesso

1. O titular entra, abre **Espaços** e cria o espaço "Família".
2. Em **Família e acesso**, define o nome de exibição e clica em
   **Gerar código** (papel "Membro"). O código aparece uma única vez e vale
   7 dias.
3. Envie o código por um canal privado. A esposa entra com a própria conta,
   abre **Família e acesso** e cola o código em "Recebi um código de convite".
4. Cada um cadastra suas contas em **Contas**. No espaço da família o outro
   membro já vem marcado para compartilhar; desmarque o que deve ser privado.

## 4. Configurar o frontend

```bash
cp .env.example .env.local
# VITE_APP_ENV=production (ou development enquanto testa)
# VITE_SUPABASE_URL=https://<ref>.supabase.co
# VITE_SUPABASE_ANON_KEY=<chave PUBLICÁVEL>   (nunca a secreta / service_role)
npm run build
```

Na hospedagem, configure as mesmas três variáveis e publique a pasta `dist/`
com redirecionamento de todas as rotas para `index.html` (SPA). Fora de
`development` o app exige `https://`.

## 5. Antes de colocar dados reais

- Rodar `npm run e2e:supabase` contra um projeto de **desenvolvimento** com
  usuários fictícios (ver `docs/roteiro-validacao.md`).
- Conferir backups do plano escolhido e ensaiar uma restauração.
- Ativar cabeçalhos de segurança (CSP, HSTS) na hospedagem.

## Importar extratos

Baixe o extrato OFX (preferível) ou CSV no site/app do banco e use
**Importar**. O arquivo é lido no navegador; só as linhas confirmadas vão ao
banco. Reimportar o mesmo arquivo não duplica lançamentos.
