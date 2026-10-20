import { describe, expect, it, vi } from 'vitest';
import { GENERIC_ERROR, NETWORK_ERROR, toUserMessage } from './errors';

describe('toUserMessage', () => {
  it('traduz códigos conhecidos sem expor a mensagem técnica', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = toUserMessage({ code: '42501', message: 'permission denied for table households' });
    expect(msg).toBe('Você não tem permissão para esta ação.');
    expect(msg).not.toContain('households');
  });

  it('trata token inválido ou expirado como sessão expirada', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserMessage({ code: 'PGRST301' })).toBe('Sua sessão expirou. Entre novamente.');
    expect(toUserMessage({ code: 'PGRST303' })).toBe('Sua sessão expirou. Entre novamente.');
  });

  it('usa mensagem genérica para erros desconhecidos', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserMessage(new Error('stack interna'))).toBe(GENERIC_ERROR);
    expect(toUserMessage(undefined)).toBe(GENERIC_ERROR);
  });

  it('identifica falha de rede', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toUserMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR);
    expect(toUserMessage({ name: 'AuthRetryableFetchError', status: 0, message: '{}' })).toBe(NETWORK_ERROR);
    expect(toUserMessage({ code: '', message: 'TypeError: Failed to fetch' })).toBe(NETWORK_ERROR);
  });
});
