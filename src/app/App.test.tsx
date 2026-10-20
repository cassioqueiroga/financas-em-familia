import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuth, fakeHouseholds } from '@/test/fakes';
import { renderApp } from '@/test/render';

describe('navegação e autenticação', () => {
  it('redireciona visitante sem sessão para a tela de entrada', async () => {
    renderApp({ auth: fakeAuth(null), households: fakeHouseholds() }, '/espacos');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Espaços' })).not.toBeInTheDocument();
  });

  it('mostra a página inicial para usuário autenticado', async () => {
    renderApp({ auth: fakeAuth({ id: 'u-1', email: null }), households: fakeHouseholds() });
    expect(await screen.findByRole('heading', { name: 'Início' })).toBeInTheDocument();
    expect(screen.getByText('Nenhum dado financeiro ainda')).toBeInTheDocument();
  });

  it('mostra erro amigável para credenciais inválidas', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderApp({ auth: fakeAuth(null), households: fakeHouseholds() }, '/entrar');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'pessoa@exemplo.test');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
  });

  it('volta para a página pedida após entrar', async () => {
    renderApp({ auth: fakeAuth(null), households: fakeHouseholds() }, '/espacos');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'pessoa@exemplo.test');
    await user.type(screen.getByLabelText('Senha'), 'senha-correta');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Espaços' })).toBeInTheDocument();
  });

  it('exibe aviso de ambiente não produtivo', async () => {
    renderApp({ auth: fakeAuth(null), households: fakeHouseholds() }, '/entrar');
    expect(await screen.findByText(/não use dados financeiros reais/)).toBeInTheDocument();
  });

  it('mostra página não encontrada', async () => {
    renderApp({ auth: fakeAuth(null), households: fakeHouseholds() }, '/nao-existe');
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument();
  });
});
