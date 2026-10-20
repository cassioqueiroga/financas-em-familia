import { describe, expect, it } from 'vitest';
import { addCents, allocateCents, cents, centsToDecimalString, formatCents, MoneyError, parseBRL } from './money';

describe('cents', () => {
  it('rejeita frações e valores fora do inteiro seguro', () => {
    expect(() => cents(10.5)).toThrow(MoneyError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => cents(Number.NaN)).toThrow(MoneyError);
  });
});

describe('addCents', () => {
  it('soma exatamente onde ponto flutuante erraria', () => {
    // 0.1 + 0.2 !== 0.3 em ponto flutuante; em centavos é exato.
    expect(addCents(cents(10), cents(20))).toBe(30);
  });
});

describe('parseBRL', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['0,5', 50],
    ['0,05', 5],
    ['10', 1000],
    ['-10,99', -1099],
    ['1.000.000,00', 100000000],
  ])('converte %s em %i centavos', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,234', '1.23,00', '12.5', '1,2,3', '--1'])('rejeita %j', (input) => {
    expect(() => parseBRL(input)).toThrow(MoneyError);
  });
});

describe('centsToDecimalString / formatCents', () => {
  it('gera decimal exato', () => {
    expect(centsToDecimalString(cents(123456))).toBe('1234.56');
    expect(centsToDecimalString(cents(5))).toBe('0.05');
    expect(centsToDecimalString(cents(-5))).toBe('-0.05');
    expect(centsToDecimalString(cents(0))).toBe('0.00');
  });

  it('formata em reais no padrão pt-BR', () => {
    // Intl usa espaço não separável entre símbolo e valor.
    expect(formatCents(cents(123456)).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatCents(cents(-5)).replace(/\s/g, ' ')).toBe('-R$ 0,05');
  });

  it('preserva precisão em valores grandes', () => {
    expect(centsToDecimalString(cents(9007199254740991))).toBe('90071992547409.91');
  });
});

describe('allocateCents', () => {
  it('preserva o total exato em parcelas', () => {
    const parts = allocateCents(cents(10000), 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('funciona com valores negativos (estornos)', () => {
    const parts = allocateCents(cents(-100), 3);
    expect(parts).toEqual([-34, -33, -33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-100);
  });

  it('soma sempre o total para várias combinações', () => {
    for (const total of [1, 99, 100, 101, 12345, 999999]) {
      for (let n = 1; n <= 24; n++) {
        const parts = allocateCents(cents(total), n);
        expect(parts).toHaveLength(n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rejeita número de parcelas inválido', () => {
    expect(() => allocateCents(cents(100), 0)).toThrow(MoneyError);
    expect(() => allocateCents(cents(100), 1.5)).toThrow(MoneyError);
  });
});
