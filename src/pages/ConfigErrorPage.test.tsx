import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@/config/env';
import { ConfigErrorPage } from './ConfigErrorPage';

describe('ConfigErrorPage', () => {
  it('lista as variáveis inválidas sem mostrar seus valores', () => {
    const result = parseConfig({ VITE_APP_ENV: 'development', VITE_SUPABASE_URL: 'valor-invalido-xyz' });
    if (result.ok) throw new Error('esperava configuração inválida');
    render(<ConfigErrorPage issues={result.issues} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('VITE_SUPABASE_URL');
    expect(alert).toHaveTextContent('VITE_SUPABASE_ANON_KEY');
    expect(alert).not.toHaveTextContent('valor-invalido-xyz');
  });
});
