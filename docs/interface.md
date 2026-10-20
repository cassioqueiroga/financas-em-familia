# Interface

## Identidade

| Token Tailwind | Cor | Uso |
| --- | --- | --- |
| `brand-900` | `#153D32` | cabeçalho, botões primários, títulos |
| `brand-500` | `#24A36A` | destaques, foco, sucesso |
| `surface` | `#F5F7F5` | fundo |
| `ink` | `#24332D` | texto principal |
| `warning` | `#D97706` | alertas, faixa de ambiente |
| `danger` | `#DC4545` | erros |

## Acessibilidade

- Contraste: branco sobre `#153D32` ≈ 11:1. `#24A36A`, `#D97706` e
  `#DC4545` ficam abaixo de 4,5:1 sobre o fundo claro, então são usados em
  bordas, ícones, realces e texto grande; o texto das mensagens usa `ink`.
- Estados: `LoadingState`/`SuccessState` com `role="status"`, `ErrorState`
  com `role="alert"`, `EmptyState` com ação sugerida.
- Link "Pular para o conteúdo", foco visível, alvos de toque ≥ 44 px,
  formulários com `label`, `prefers-reduced-motion` respeitado.
- Layout responsivo verificado em 390 px e 1280 px.

## Dados fictícios

A interface não exibe números financeiros de exemplo. Telas sem dados mostram
estado vazio explicando o que virá.
