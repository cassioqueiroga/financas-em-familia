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

/** Mês corrente (AAAA-MM) no fuso informado. */
export function currentMonth(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return toBusinessDate(now, timeZone).slice(0, 7);
}

/** Primeiro e último dia (AAAA-MM-DD) de um mês AAAA-MM, sem depender do fuso. */
export function monthBounds(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new RangeError('Mês inválido');
  const year = Number(match[1]);
  const m = Number(match[2]);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Soma meses a AAAA-MM. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** "2026-03-10" → "10/03/2026" (data de negócio, sem conversão de fuso). */
export function formatBusinessDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-03" ou "2026-03-01" → "março de 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} de ${y}`;
}

/** Valida AAAA-MM-DD como data de calendário real. */
export function isBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === Number(match[2]) - 1 && d.getUTCDate() === Number(match[3]);
}
