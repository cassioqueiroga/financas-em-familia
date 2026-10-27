import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Entry } from '@/features/finance/types';
import { fakeAuth, fakeFinance, fakeHouseholds, fakeSharing, makeAccount, makeEntry, makeHousehold, makeSummary, writeGrants } from '@/test/fakes';
import { renderApp } from '@/test/render';
import { currentMonth } from '@/lib/dates';

const signedIn = () => fakeAuth({ id: 'u-1', email: null });
const family = makeHousehold({ id: 'h-1', name: 'Família', kind: 'family' });
const checking = makeAccount({ id: 'a-1', name: 'Nubank' });
const savings = makeAccount({ id: 'a-2', name: 'Reserva', kind: 'savings' });
const card = makeAccount({ id: 'a-3', name: 'Visa', kind: 'credit_card', credit_limit_cents: 500000, closing_day: 5, due_day: 15 });

function setup(path: string, accounts: Account[], extra: Parameters<typeof fakeFinance>[0] = {}) {
  const finance = fakeFinance({ listAccounts: async () => accounts, listGrants: async () => writeGrants(accounts), ...extra });
  const sharing = fakeSharing({
    listMembers: async () => [
      { user_id: 'u-1', role: 'owner', display_name: 'Chefe', joined_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-2', role: 'member', display_name: 'Esposa', joined_at: '2026-01-02T00:00:00Z' },
    ],
  });
  renderApp({ auth: signedIn(), households: fakeHouseholds({ list: async () => [family] }), finance, sharing }, path);
  return { finance, sharing, user: userEvent.setup() };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe('Início', () => {
  it('pede a primeira conta quando o espaço não tem contas', async () => {
    setup('/', []);
    expect(await screen.findByText('Cadastre sua primeira conta')).toBeInTheDocument();
  });

  it('mostra o resumo do mês em reais a partir de centavos', async () => {
    setup('/', [checking], {
      monthlySummary: async (_h, month) =>
        makeSummary({
          month: `${month}-01`,
          income_cents: 1000000,
          expense_cents: 123456,
          result_cents: 876544,
          available_cents: 250075,
          expenses_by_category: [{ category_id: 'c-1', name: 'Mercado', total_cents: 123456 }],
        }),
    });
    expect(await screen.findByText('Saldo disponível hoje')).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s?1\.234,56/).length).toBeGreaterThan(0);
    expect(screen.getByText(/R\$\s?10\.000,00/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Despesas por categoria' })).getByText('Mercado')).toBeInTheDocument();
  });
});

describe('Contas', () => {
  it('valida o nome e não chama o servidor', async () => {
    const { finance, user } = setup('/contas', []);
    await user.click(await screen.findByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um nome de até 60 caracteres.');
    expect(finance.calls.createAccount).toBeUndefined();
  });

  it('cria conta com saldo inicial em centavos e compartilha com a esposa por padrão', async () => {
    const { finance, user } = setup('/contas', []);
    await user.type(await screen.findByLabelText('Nome'), 'Itaú');
    await user.type(screen.getByLabelText('Saldo inicial (R$)'), '1.234,56');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));
    await waitFor(() => expect(finance.calls.createAccount).toHaveLength(1));
    const input = finance.calls.createAccount![0] as { name: string; initialBalanceCents: number; shareWith: string[] };
    expect(input.name).toBe('Itaú');
    expect(input.initialBalanceCents).toBe(123456);
    expect(input.shareWith).toEqual(['u-2']);
  });

  it('exige dias de fechamento e vencimento para cartão', async () => {
    const { finance, user } = setup('/contas', []);
    await user.type(await screen.findByLabelText('Nome'), 'Visa');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'credit_card');
    await user.type(screen.getByLabelText('Limite (R$)'), '5.000,00');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe dias de fechamento e vencimento entre 1 e 28.');
    expect(finance.calls.createAccount).toBeUndefined();
  });
});

describe('Lançamentos', () => {
  it('registra despesa pendente com valor em centavos', async () => {
    const { finance, user } = setup('/lancamentos', [checking]);
    await user.type(await screen.findByLabelText('Descrição'), 'Conta de luz');
    await user.type(screen.getByLabelText('Valor (R$)'), '189,90');
    await user.selectOptions(within(screen.getByRole('form', { name: 'Novo lançamento' })).getByLabelText('Conta'), 'a-1');
    await user.click(screen.getByLabelText('Ainda não paguei (conta a pagar)'));
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Despesa registrada.')).toBeInTheDocument();
    const input = finance.calls.createEntry![0] as { kind: string; amountCents: number; status: string; accountId: string };
    expect(input).toMatchObject({ kind: 'expense', amountCents: 18990, status: 'pending', accountId: 'a-1', attributedTo: 'u-1' });
  });

  it('recusa valor inválido e zero', async () => {
    const { finance, user } = setup('/lancamentos', [checking]);
    await user.type(await screen.findByLabelText('Descrição'), 'Teste');
    await user.type(screen.getByLabelText('Valor (R$)'), '0');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um valor maior que zero.');
    await user.clear(screen.getByLabelText('Valor (R$)'));
    await user.type(screen.getByLabelText('Valor (R$)'), '12,345');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Valor inválido');
    expect(finance.calls.createEntry).toBeUndefined();
  });

  it('registra receita', async () => {
    const { finance, user } = setup('/lancamentos', [checking]);
    await user.click(await screen.findByLabelText('Receita'));
    await user.type(screen.getByLabelText('Descrição'), 'Salário');
    await user.type(screen.getByLabelText('Valor (R$)'), '5.000');
    await user.selectOptions(within(screen.getByRole('form', { name: 'Novo lançamento' })).getByLabelText('Conta'), 'a-1');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Receita registrada.')).toBeInTheDocument();
    expect(finance.calls.createEntry![0]).toMatchObject({ kind: 'income', amountCents: 500000, status: 'posted' });
  });

  it('transferência exige destino diferente da origem', async () => {
    const { finance, user } = setup('/lancamentos', [checking, savings]);
    await user.click(await screen.findByLabelText('Transferência'));
    await user.type(screen.getByLabelText('Descrição'), 'Guardar');
    await user.type(screen.getByLabelText('Valor (R$)'), '300');
    await user.selectOptions(screen.getByLabelText('De (origem)'), 'a-1');
    await user.selectOptions(screen.getByLabelText('Para (destino)'), 'a-1');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha uma conta de destino diferente da origem.');
    expect(finance.calls.createTransfer).toBeUndefined();
    await user.selectOptions(screen.getByLabelText('Para (destino)'), 'a-2');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Transferência registrada.')).toBeInTheDocument();
    expect(finance.calls.createTransfer![0]).toMatchObject({ fromAccountId: 'a-1', toAccountId: 'a-2', amountCents: 30000 });
  });

  it('cancelar pede confirmação antes de chamar o servidor', async () => {
    const entry: Entry = makeEntry({ id: 'e-9', description: 'Padaria', occurred_on: new Date().toISOString().slice(0, 10) });
    const { finance, user } = setup('/lancamentos', [checking], { listEntries: async () => [entry] });
    await user.click(await screen.findByRole('button', { name: 'Cancelar lançamento' }));
    expect(finance.calls.cancelEntry).toBeUndefined();
    const group = screen.getByRole('group', { name: 'Cancelar lançamento' });
    expect(group).toHaveTextContent('Ele fica no histórico como cancelado.');
    await user.click(within(group).getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(finance.calls.cancelEntry).toEqual([['e-9', 1]]));
  });

  it('mostra mensagem segura quando o servidor recusa por concorrência', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = setup('/lancamentos', [checking], {
      createEntry: async () => {
        throw { code: '40001', message: 'serialization_failure on table transactions' };
      },
    });
    await user.type(await screen.findByLabelText('Descrição'), 'Teste');
    await user.type(screen.getByLabelText('Valor (R$)'), '10');
    await user.selectOptions(within(screen.getByRole('form', { name: 'Novo lançamento' })).getByLabelText('Conta'), 'a-1');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('transactions');
  });
});

describe('Cartões', () => {
  it('registra compra parcelada', async () => {
    const { finance, user } = setup('/cartoes', [checking, card]);
    await user.type(await screen.findByLabelText('Descrição'), 'Geladeira');
    await user.type(screen.getByLabelText('Valor total (R$)'), '1.000,00');
    await user.clear(screen.getByLabelText('Parcelas', { exact: false }));
    await user.type(screen.getByLabelText('Parcelas', { exact: false }), '3');
    await user.click(screen.getByRole('button', { name: 'Registrar compra' }));
    await waitFor(() => expect(finance.calls.createCardPurchase).toHaveLength(1));
    expect(finance.calls.createCardPurchase![0]).toMatchObject({ cardAccountId: 'a-3', totalCents: 100000, installmentCount: 3 });
  });

  it('recusa mais de 48 parcelas', async () => {
    const { finance, user } = setup('/cartoes', [card]);
    await user.type(await screen.findByLabelText('Descrição'), 'X');
    await user.type(screen.getByLabelText('Valor total (R$)'), '10');
    await user.clear(screen.getByLabelText('Parcelas', { exact: false }));
    await user.type(screen.getByLabelText('Parcelas', { exact: false }), '49');
    await user.click(screen.getByRole('button', { name: 'Registrar compra' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Parcelas devem ser de 1 a 48.');
    expect(finance.calls.createCardPurchase).toBeUndefined();
  });

  it('paga a fatura a partir de uma conta', async () => {
    const { finance, user } = setup('/cartoes', [checking, card], {
      cardStatements: async () => [
        { statement_month: '2026-11-01', closing_date: '2026-11-05', due_date: '2026-11-15', total_cents: 33334, paid_cents: 0, remaining_cents: 33334, status: 'open' },
      ],
    });
    await user.click(await screen.findByRole('button', { name: 'Pagar fatura' }));
    const form = screen.getByRole('form', { name: /Pagar fatura de/ });
    expect(within(form).getByLabelText('Valor (R$)')).toHaveValue('333,34');
    await user.selectOptions(within(form).getByLabelText('Pagar com'), 'a-1');
    await user.click(within(form).getByRole('button', { name: 'Registrar pagamento' }));
    await waitFor(() => expect(finance.calls.payStatement).toHaveLength(1));
    expect(finance.calls.payStatement![0]).toMatchObject({ cardAccountId: 'a-3', fromAccountId: 'a-1', amountCents: 33334 });
  });
});

describe('Importar', () => {
  it('lê um OFX, mostra a pré-visualização e importa só os novos', async () => {
    const ofx = `OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261020<TRNAMT>-45.90<FITID>A1<MEMO>PADARIA FICTICIA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261021<TRNAMT>100.00<FITID>A2<MEMO>PIX RECEBIDO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const { finance, user } = setup('/importar', [checking, card], {
      previewImport: async (_a, rows) => rows.map((_, index) => ({ index, status: index === 0 ? ('duplicate' as const) : ('new' as const), reason: null })),
    });
    await user.selectOptions(await screen.findByLabelText('Conta de destino'), 'a-1');
    expect(screen.queryByRole('option', { name: /Visa/ })).not.toBeInTheDocument();
    const file = new File([ofx], 'extrato.ofx', { type: 'application/x-ofx' });
    await user.upload(screen.getByLabelText('Arquivo (.ofx ou .csv, até 2 MB)'), file);
    expect(await screen.findByText('Já importado')).toBeInTheDocument();
    expect(screen.getByLabelText('Importar PADARIA FICTICIA')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Importar 1 lançamento(s)' }));
    expect(await screen.findByText(/Importação concluída: 1 lançamento/)).toBeInTheDocument();
    const [, rows, source] = finance.calls.importEntries![0] as [string, { amount_cents: number; description: string }[], string];
    expect(source).toBe('ofx');
    expect(rows).toEqual([expect.objectContaining({ amount_cents: 10000, description: 'PIX RECEBIDO' })]);
  });
});

describe('Família', () => {
  it('gera código de convite e mostra uma única vez', async () => {
    const { user } = setup('/familia', []);
    await user.click(await screen.findByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByLabelText('Código de convite')).toHaveTextContent('ABCD-EF01-2345');
  });

  it('exige o código antes de aceitar', async () => {
    const { user } = setup('/familia', []);
    await user.click(await screen.findByRole('button', { name: 'Entrar no espaço' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cole o código recebido.');
  });
});

describe('Análises', () => {
  it('mostra evolução, diagnóstico e faturas comprometidas', async () => {
    const { finance } = setup('/analises', [checking, card], {
      monthlySummary: async (_h, month) =>
        makeSummary({
          month: `${month}-01`,
          income_cents: 1000000,
          expense_cents: 1100000,
          result_cents: -100000,
          available_cents: 200000,
          expenses_by_category: [{ category_id: 'c-1', name: 'Mercado', total_cents: 1100000 }],
        }),
      cardStatements: async () => [
        { statement_month: '2099-01-01', closing_date: '2099-01-05', due_date: '2099-01-15', total_cents: 1, paid_cents: 0, remaining_cents: 1, status: 'open' },
      ],
    });
    expect(await screen.findByRole('heading', { name: 'Diagnóstico e sugestões' })).toBeInTheDocument();
    expect(screen.getByText(/meses seguidos gastando mais do que entrou/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evolução mensal' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Categorias:/ })).getByText('Mercado')).toBeInTheDocument();
    expect(finance.calls.monthlySummary).toHaveLength(6);
    expect(finance.calls.cardStatements).toHaveLength(1);
  });

  it('troca para 12 meses', async () => {
    const { finance, user } = setup('/analises', [checking]);
    await user.click(await screen.findByRole('button', { name: '12 meses' }));
    await waitFor(() => expect(finance.calls.monthlySummary).toHaveLength(18));
  });
});

describe('Análises aprofundadas', () => {
  it('mostra índice de saúde e regra 50-30-20 na visão do período', async () => {
    setup('/analises', [checking], {
      monthlySummary: async (_h, month) =>
        makeSummary({
          month: `${month}-01`,
          income_cents: 1000000,
          expense_cents: 700000,
          result_cents: 300000,
          available_cents: 3000000,
          expenses_by_category: [{ category_id: 'c-1', name: 'Moradia', total_cents: 700000 }],
        }),
    });
    expect(await screen.findByRole('heading', { name: 'Índice de saúde financeira' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /regra 50-30-20/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Despesas recorrentes detectadas' })).toBeInTheDocument();
  });

  it('abre o mês em detalhe com ritmo, maiores despesas e dias da semana', async () => {
    const { finance, user } = setup('/analises', [checking], {
      listEntries: async () => [makeEntry({ id: 'x-1', description: 'Aluguel', amount_cents: 250000, occurred_on: `${currentMonth()}-01` })],
    });
    await user.click(await screen.findByRole('button', { name: 'Mês em detalhe' }));
    expect(await screen.findByRole('heading', { name: 'Ritmo de gastos no mês' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gastos por dia da semana' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Maiores despesas do mês' })).getByText('Aluguel')).toBeInTheDocument();
    await waitFor(() => expect(finance.calls.listEntries!.length).toBeGreaterThanOrEqual(2));
  });
});
