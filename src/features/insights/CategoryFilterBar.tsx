import { useFinance } from '@/features/finance/FinanceContext';
import type { CategoryFilter } from './ytd';

/**
 * Filtro de categorias de despesa. Vale para os números de despesa das três
 * abas; receita, resultado, índice de saúde e diagnóstico não são filtrados.
 */
export function CategoryFilterBar({ value, onChange }: { value: CategoryFilter; onChange(next: CategoryFilter): void }) {
  const { data } = useFinance();
  const options = [
    ...data.categories
      .filter((c) => c.kind === 'expense')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((c) => ({ key: c.id, label: c.name })),
    { key: 'sem', label: 'Sem categoria' },
  ];
  const toggle = (key: string) => {
    const next = new Set(value ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next.size === 0 ? null : next);
  };
  const chip = (active: boolean) =>
    `min-h-9 rounded-full border px-3 py-1 text-sm ${active ? 'border-brand-900 bg-brand-900 text-white' : 'border-ink/20 bg-white text-ink hover:bg-surface'}`;
  return (
    <details className="rounded-xl bg-white p-3 shadow-sm" open={value !== null}>
      <summary className="cursor-pointer text-sm font-semibold">
        Filtrar despesas por categoria{value ? ` · ${value.size} selecionada${value.size > 1 ? 's' : ''}` : ' · todas'}
      </summary>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Categorias de despesa">
        <button type="button" className={chip(value === null)} aria-pressed={value === null} onClick={() => onChange(null)}>
          Todas
        </button>
        {options.map((o) => (
          <button key={o.key} type="button" className={chip(value?.has(o.key) ?? false)} aria-pressed={value?.has(o.key) ?? false} onClick={() => toggle(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink/60">O filtro muda só os números de despesa. Receitas, resultado, índice de saúde e diagnóstico usam todos os lançamentos.</p>
    </details>
  );
}
