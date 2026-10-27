import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';

const SHORT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "outubro de 2026" → "Outubro de 2026" (CSS capitalize também afetaria "de"). */
export const monthTitle = (month: string) => formatMonth(month).replace(/^./, (c) => c.toUpperCase());

export const shortMonth = (month: string) => `${SHORT_MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`;

export const formatBRL = (value: number) => formatCents(cents(value));
