import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState, ErrorState, LoadingState, SuccessState } from './StatusViews';

describe('StatusViews', () => {
  it('LoadingState é anunciado como status', () => {
    render(<LoadingState label="Carregando espaços…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando espaços…');
  });

  it('ErrorState é anunciado como alerta e mostra a ação', () => {
    render(<ErrorState message="Falhou" action={<button>Tentar de novo</button>} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('EmptyState mostra título e descrição', () => {
    render(<EmptyState title="Nada aqui" description="Crie o primeiro" />);
    expect(screen.getByText('Nada aqui')).toBeInTheDocument();
    expect(screen.getByText('Crie o primeiro')).toBeInTheDocument();
  });

  it('SuccessState é anunciado como status', () => {
    render(<SuccessState message="Pronto" />);
    expect(screen.getByRole('status')).toHaveTextContent('Pronto');
  });
});
