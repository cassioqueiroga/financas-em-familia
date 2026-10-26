import { useState, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * Ação sensível em dois passos: o primeiro clique pede confirmação explícita
 * no próprio lugar (acessível por teclado e leitor de tela).
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = 'Confirmar',
  onConfirm,
  disabled,
}: {
  label: string;
  question: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <Button variant="ghost" className="text-sm" disabled={disabled ?? false} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-surface px-2 py-1 text-sm">
      <span>{question}</span>
      <Button
        variant="primary"
        className="min-h-9 py-1"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="secondary" className="min-h-9 py-1" onClick={() => setAsking(false)}>
        Voltar
      </Button>
    </span>
  );
}
