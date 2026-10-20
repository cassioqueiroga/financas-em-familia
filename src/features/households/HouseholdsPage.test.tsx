import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuth, fakeHouseholds, makeHousehold } from '@/test/fakes';
import { renderApp } from '@/test/render';

const signedIn = () => fakeAuth({ id: 'u-1', email: null });

describe('HouseholdsPage', () => {
  it('mostra estado vazio quando não há espaços', async () => {
    renderApp({ auth: signedIn(), households: fakeHouseholds() }, '/espacos');
    expect(await screen.findByText('Você ainda não tem espaços')).toBeInTheDocument();
  });

  it('lista os espaços retornados pelo repositório', async () => {
    const repo = fakeHouseholds({ list: async () => [makeHousehold({ name: 'Casa', kind: 'family' })] });
    renderApp({ auth: signedIn(), households: repo }, '/espacos');
    expect(await screen.findByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Família · BRL')).toBeInTheDocument();
  });

  it('mostra erro sem detalhes técnicos e permite tentar de novo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const repo = fakeHouseholds({
      list: async () => {
        calls++;
        if (calls === 1) throw { code: '42501', message: 'permission denied for table households' };
        return [];
      },
    });
    renderApp({ auth: signedIn(), households: repo }, '/espacos');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Você não tem permissão para esta ação.');
    expect(alert).not.toHaveTextContent('households');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Você ainda não tem espaços')).toBeInTheDocument();
  });

  it('valida o nome antes de enviar', async () => {
    const repo = fakeHouseholds();
    renderApp({ auth: signedIn(), households: repo }, '/espacos');
    await screen.findByText('Você ainda não tem espaços');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Criar espaço' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe um nome.');
    expect(repo.createCalls).toHaveLength(0);
  });

  it('reutiliza a chave de idempotência ao tentar de novo após falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempt = 0;
    const repo = fakeHouseholds({
      create: async (input) => {
        attempt++;
        if (attempt === 1) throw new TypeError('Failed to fetch');
        return makeHousehold({ name: input.name });
      },
    });
    renderApp({ auth: signedIn(), households: repo }, '/espacos');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'Minhas finanças');
    await user.click(screen.getByRole('button', { name: 'Criar espaço' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
    await user.click(screen.getByRole('button', { name: 'Criar espaço' }));
    expect(await screen.findByText('Espaço “Minhas finanças” criado.')).toBeInTheDocument();

    expect(repo.createCalls).toHaveLength(2);
    expect(repo.createCalls[0]?.idempotencyKey).toBe(repo.createCalls[1]?.idempotencyKey);
    expect(repo.createCalls[0]).toMatchObject({ name: 'Minhas finanças', kind: 'personal' });
  });

  it('gera nova chave para uma nova criação após sucesso', async () => {
    const repo = fakeHouseholds();
    renderApp({ auth: signedIn(), households: repo }, '/espacos');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Nome'), 'A');
    await user.click(screen.getByRole('button', { name: 'Criar espaço' }));
    await screen.findByText('Espaço “A” criado.');
    await user.type(screen.getByLabelText('Nome'), 'B');
    await user.click(screen.getByRole('button', { name: 'Criar espaço' }));
    await waitFor(() => expect(repo.createCalls).toHaveLength(2));
    expect(repo.createCalls[0]?.idempotencyKey).not.toBe(repo.createCalls[1]?.idempotencyKey);
  });
});
