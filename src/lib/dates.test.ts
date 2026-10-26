import { describe, expect, it } from 'vitest';
import { addMonths, currentMonth, formatBusinessDate, formatMonth, isBusinessDate, isValidTimeZone, monthBounds, toBusinessDate } from './dates';

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

describe('meses e formatação', () => {
  it('currentMonth usa o fuso de São Paulo', () => {
    expect(currentMonth(undefined, new Date('2026-04-01T02:00:00Z'))).toBe('2026-03');
  });

  it('monthBounds considera anos bissextos', () => {
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(() => monthBounds('2026-13x')).toThrow();
  });

  it('addMonths atravessa anos nos dois sentidos', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-03', 12)).toBe('2027-03');
  });

  it('formata datas e meses em pt-BR', () => {
    expect(formatBusinessDate('2026-03-10')).toBe('10/03/2026');
    expect(formatMonth('2026-03-01')).toBe('março de 2026');
  });

  it('isBusinessDate rejeita datas inexistentes', () => {
    expect(isBusinessDate('2026-02-29')).toBe(false);
    expect(isBusinessDate('2028-02-29')).toBe(true);
    expect(isBusinessDate('10/03/2026')).toBe(false);
  });
});
