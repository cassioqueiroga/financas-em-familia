/**
 * Primitivas monetárias.
 *
 * Regra: valores oficiais são inteiros em centavos (`Cents`). Nunca somar,
 * dividir ou arredondar reais em ponto flutuante. Conversão para exibição
 * usa string decimal exata (Intl.NumberFormat aceita string desde ES2023).
 *
 * Limite: Number.MAX_SAFE_INTEGER centavos (~R$ 90 trilhões). O banco usa
 * bigint (`public.money_cents`); valores acima do limite seguro do JS são
 * rejeitados aqui para não perder precisão silenciosamente.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError('Valor monetário deve ser um inteiro seguro em centavos');
  }
  return value as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce<number>((sum, v) => sum + v, 0));
}

/**
 * Converte texto digitado em pt-BR ("1.234,56", "-10", "0,5") para centavos,
 * sem passar por ponto flutuante. Aceita no máximo 2 casas decimais.
 */
export function parseBRL(input: string): Cents {
  const normalized = input.replace(/\s|R\$/g, '');
  const match = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new MoneyError('Valor inválido. Use o formato 1.234,56');
  }
  const [, sign, intPart = '0', frac = ''] = match;
  const digits = intPart.replace(/\./g, '') + frac.padEnd(2, '0');
  const value = Number(digits);
  return cents(sign ? -value : value);
}

/** Representação decimal exata, ex.: 123456 -> "1234.56", -5 -> "-0.05". */
export function centsToDecimalString(value: Cents): string {
  const negative = value < 0;
  const abs = String(Math.abs(value)).padStart(3, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export function formatCents(value: Cents, currency = 'BRL', locale = 'pt-BR'): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Intl aceita string decimal exata (Intl.NumberFormat v3); o tipo do TS ainda não reflete isso.
  return formatter.format(centsToDecimalString(value) as unknown as number);
}

/**
 * Divide um total em `parts` parcelas inteiras cuja soma é exatamente o total.
 * O resto é distribuído, um centavo por vez, a partir da primeira parcela.
 * Primitiva para parcelamentos futuros; não implementa o módulo de cartões.
 */
export function allocateCents(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError('Número de parcelas deve ser um inteiro positivo');
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs % parts;
  return Array.from({ length: parts }, (_, i) => cents(sign * (base + (i < remainder ? 1 : 0))));
}
