import { describe, expect, it, vi } from 'vitest';
import { logger, redact } from './logger';

describe('redact', () => {
  it('oculta chaves sensíveis em qualquer nível', () => {
    const out = redact({
      user: { email: 'pessoa@exemplo.test', nome: 'Ana' },
      password: '123',
      headers: { Authorization: 'Bearer x' },
      saldo: 1000,
    });
    expect(out).toEqual({
      user: { email: '[redigido]', nome: 'Ana' },
      password: '[redigido]',
      headers: { Authorization: '[redigido]' },
      saldo: '[redigido]',
    });
  });

  it('oculta tokens JWT dentro de textos', () => {
    expect(redact('falha com eyJhbGciOi.eyJzdWIiOiIx.c2ln no header')).toBe('falha com [redigido] no header');
  });
});

describe('logger', () => {
  it('aplica a redação antes de escrever no console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('falha', { token: 'abc', etapa: 'login' });
    expect(spy).toHaveBeenCalledWith('[error] falha', { token: '[redigido]', etapa: 'login' });
  });
});
