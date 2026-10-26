import { cents, formatCents } from '@/lib/money';

/** Valor em reais com sinal opcional e cor por sentido (cor nunca é a única indicação). */
export function Amount({ value, tone = 'neutral', className = '' }: { value: number; tone?: 'neutral' | 'signed'; className?: string }) {
  const color = tone === 'signed' ? (value < 0 ? 'text-danger-text' : value > 0 ? 'text-success-text' : '') : '';
  return <span className={`tabular-nums ${color} ${className}`}>{formatCents(cents(value))}</span>;
}
