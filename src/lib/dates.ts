/**
 * Regras de data e fuso horário.
 *
 * - Instantes (quando algo aconteceu) são `timestamptz` no banco, em UTC.
 * - Datas de negócio (competência, vencimento) são `date` sem hora,
 *   interpretadas no fuso do espaço (household.timezone).
 * - O fuso padrão é America/Sao_Paulo; nunca usar o fuso do navegador
 *   implicitamente para decidir a data de um lançamento.
 */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Data de negócio (YYYY-MM-DD) de um instante em um fuso IANA explícito. */
export function toBusinessDate(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
