import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const inputClass = 'w-full rounded-lg border border-ink/30 bg-white px-3 py-2 min-h-11 disabled:bg-surface';

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink/70">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${className}`} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${className}`}>
      {children}
    </select>
  );
}

/** Campo de valor em reais: texto livre "1.234,56", convertido sem ponto flutuante por parseBRL. */
export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput inputMode="decimal" autoComplete="off" placeholder="0,00" {...props} />;
}
