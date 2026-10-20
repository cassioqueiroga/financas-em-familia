import { describe, expect, it } from 'vitest';
import { isValidTimeZone, toBusinessDate } from './dates';

describe('toBusinessDate', () => {
  it('usa o fuso de São Paulo por padrão, não UTC', () => {
    // 02:00 UTC de 1º de janeiro ainda é 31 de dezembro em São Paulo (UTC-3).
    expect(toBusinessDate(new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31');
    expect(toBusinessDate(new Date('2026-01-01T03:00:00Z'))).toBe('2026-01-01');
  });

  it('respeita fuso explícito', () => {
    expect(toBusinessDate(new Date('2026-01-01T02:00:00Z'), 'UTC')).toBe('2026-01-01');
    expect(toBusinessDate(new Date('2026-01-01T02:00:00Z'), 'America/Manaus')).toBe('2025-12-31');
  });
});

describe('isValidTimeZone', () => {
  it('valida nomes IANA', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Marte/Base')).toBe(false);
  });
});
