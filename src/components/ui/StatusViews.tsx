import type { ReactNode } from 'react';

/**
 * Estados padronizados de tela: carregando, erro, sem dados e concluído.
 * Cada um usa a role ARIA adequada para leitores de tela.
 */

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl bg-white p-6 text-ink/80">
      <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border-l-4 border-danger bg-white p-6">
      <p className="font-semibold text-ink">Algo deu errado</p>
      <p className="mt-1 text-ink/80">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-900/25 bg-white p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 text-ink/70">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function SuccessState({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border-l-4 border-brand-500 bg-white p-4 text-ink">
      {message}
    </div>
  );
}

export function WarningNotice({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border-l-4 border-warning bg-white p-4 text-ink">{children}</div>;
}
