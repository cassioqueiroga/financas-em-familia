import type { ReactNode } from 'react';
import { formatBRL } from './format';

export function Tile({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-sm text-ink/70">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{children}</p>
      {hint && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
    </div>
  );
}

export function Card({ id, title, subtitle, children }: { id: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl bg-white p-4 shadow-sm">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {subtitle && <p className="mb-3 text-xs text-ink/60">{subtitle}</p>}
      {children}
    </section>
  );
}

/** Variação com sinal e texto (cor nunca é a única indicação). Para despesa, subir é ruim. */
export function Delta({ current, previous, goodWhenDown = true }: { current: number; previous: number; goodWhenDown?: boolean }) {
  if (previous === 0) return <span className="text-ink/60">sem base</span>;
  const change = (current - previous) / Math.abs(previous);
  const up = change > 0;
  const good = goodWhenDown ? !up : up;
  const color = Math.abs(change) < 0.005 ? 'text-ink/70' : good ? 'text-success-text' : 'text-danger-text';
  return (
    <span className={`tabular-nums ${color}`}>
      {up ? '▲' : change < 0 ? '▼' : '='} {Math.abs(Math.round(change * 100))}%
    </span>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** Classe Tailwind de fundo; `pattern` usa listras para o que não tem grupo. */
  className: string;
}

/** Barra 100% empilhada com legenda e valores sempre visíveis. */
export function StackedBar({ segments, total, label }: { segments: Segment[]; total: number; label: string }) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div role="img" aria-label={label} className="flex h-5 w-full gap-0.5 overflow-hidden rounded bg-surface">
        {visible.map((s) => (
          <div
            key={s.key}
            title={`${s.label}: ${formatBRL(s.value)}`}
            className={`h-full first:rounded-l last:rounded-r ${s.className}`}
            style={{ width: `${(s.value / Math.max(total, 1)) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export const STRIPES = 'bg-[repeating-linear-gradient(135deg,var(--color-ink)_0_2px,transparent_2px_6px)] opacity-40';

/**
 * Linhas de gasto acumulado por dia. Uma escala só; série principal sólida
 * (2px), referência tracejada em tom neutro. Rótulo direto no fim de cada linha.
 */
export function CumulativeChart({
  series,
  label,
}: {
  series: { key: string; label: string; values: number[]; dashed?: boolean; className: string }[];
  label: string;
}) {
  const W = 640;
  const H = 200;
  const PAD = { l: 22, r: 96, t: 12, b: 22 };
  const days = Math.max(...series.map((s) => s.values.length), 1);
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const x = (i: number) => PAD.l + (i / Math.max(days - 1, 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const ticks = [1, 10, 20, days];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="stroke-ink/20" strokeWidth={1} />
      {ticks.map((d) => (
        <text key={d} x={x(d - 1)} y={H - 6} textAnchor="middle" className="fill-ink/60 text-[11px]">
          dia {d}
        </text>
      ))}
      {series.map((s) => {
        if (s.values.length === 0) return null;
        const points = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        const lastI = s.values.length - 1;
        return (
          <g key={s.key}>
            <polyline points={points} fill="none" strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? '5 4' : undefined} className={s.className}>
              <title>{`${s.label}: ${formatBRL(s.values[lastI]!)} até o dia ${lastI + 1}`}</title>
            </polyline>
            <circle cx={x(lastI)} cy={y(s.values[lastI]!)} r={4} className={`${s.className} fill-white`} strokeWidth={2} />
            <text x={x(lastI) + 8} y={y(s.values[lastI]!) + 4} className="fill-ink text-[11px]">
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
