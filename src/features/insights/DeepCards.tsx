import { Amount } from '@/components/ui/Amount';
import { useFinance } from '@/features/finance/FinanceContext';
import type { Entry, MonthlySummary } from '@/features/finance/types';
import { formatBusinessDate } from '@/lib/dates';
import type { Analysis } from './analysis';
import { BAND_LABEL, GROUP_LABEL, averageSplit, categoryGroups, categoryName, detectRecurring, healthScore, splitByGroup, type BudgetSplit } from './deep';
import { Card, STRIPES, StackedBar } from './ui';

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export function HealthCard({ analysis, last }: { analysis: Analysis; last: MonthlySummary }) {
  const h = healthScore(analysis, last);
  return (
    <Card
      id="titulo-saude"
      title="Índice de saúde financeira"
      subtitle="De 0 a 100, inspirado no FinHealth Score (Financial Health Network) e adaptado ao que o app registra."
    >
      {h.score === null ? (
        <p className="text-sm text-ink/70">Ainda faltam dados: são necessários pelo menos dois indicadores com meses fechados.</p>
      ) : (
        <p className="mb-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{h.score}</span>
          <span className="text-sm text-ink/70">de 100 · {BAND_LABEL[h.band!]}</span>
        </p>
      )}
      <ul className="space-y-3">
        {h.pillars.map((p) => (
          <li key={p.key}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-medium">{p.label}</span>
              <span className="tabular-nums">{p.score === null ? '—' : p.score}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-surface" aria-hidden="true">
              {p.score !== null && <div className="h-2 rounded bg-brand-900" style={{ width: `${p.score}%` }} />}
            </div>
            <p className="mt-1 text-xs text-ink/60">{p.basis}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink/60">Faixas: 80 ou mais saudável; 40 a 79 em equilíbrio; abaixo de 40 vulnerável.</p>
    </Card>
  );
}

function SplitLegend({ split }: { split: BudgetSplit }) {
  const rows = [
    { key: 'e', label: GROUP_LABEL.essential, value: split.essential_cents, target: '50%', swatch: 'bg-chart-essential' },
    { key: 'l', label: GROUP_LABEL.lifestyle, value: split.lifestyle_cents, target: '30%', swatch: 'bg-chart-expense' },
    { key: 'u', label: GROUP_LABEL.unclassified, value: split.unclassified_cents, target: '—', swatch: STRIPES },
    { key: 's', label: 'Poupança (sobra)', value: split.savings_cents, target: '20%', swatch: 'bg-chart-income' },
  ];
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-ink/70">
          <th scope="col" className="py-1 font-medium">Grupo</th>
          <th scope="col" className="py-1 text-right font-medium">Valor/mês</th>
          <th scope="col" className="py-1 text-right font-medium">Da receita</th>
          <th scope="col" className="py-1 text-right font-medium">Referência</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/10">
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className="py-1 text-left font-normal">
              <span aria-hidden="true" className={`mr-2 inline-block size-3 rounded-sm align-middle ${r.swatch}`} />
              {r.label}
            </th>
            <td className="py-1 text-right">
              <Amount value={r.value} tone={r.key === 's' ? 'signed' : 'neutral'} />
            </td>
            <td className="py-1 text-right tabular-nums">{pct(r.value, split.income_cents)}</td>
            <td className="py-1 text-right tabular-nums text-ink/70">{r.target}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BudgetRuleCard({ summaries }: { summaries: MonthlySummary[] }) {
  const { data } = useFinance();
  const groups = categoryGroups(data.categories);
  const split = averageSplit(summaries.map((s) => splitByGroup(s, groups)));
  return (
    <Card
      id="titulo-503020"
      title="Para onde vai a receita (regra 50-30-20)"
      subtitle="Média dos meses fechados. Referência: até 50% em necessidades, até 30% em estilo de vida e ao menos 20% poupados."
    >
      {!split || split.income_cents <= 0 ? (
        <p className="text-sm text-ink/70">Sem receita em meses fechados para comparar.</p>
      ) : (
        <>
          <StackedBar
            label="Divisão média da receita entre necessidades, estilo de vida, sem grupo e poupança"
            total={Math.max(split.income_cents, split.essential_cents + split.lifestyle_cents + split.unclassified_cents)}
            segments={[
              { key: 'e', label: GROUP_LABEL.essential, value: split.essential_cents, className: 'bg-chart-essential' },
              { key: 'l', label: GROUP_LABEL.lifestyle, value: split.lifestyle_cents, className: 'bg-chart-expense' },
              { key: 'u', label: GROUP_LABEL.unclassified, value: split.unclassified_cents, className: STRIPES },
              { key: 's', label: 'Poupança', value: Math.max(split.savings_cents, 0), className: 'bg-chart-income' },
            ]}
          />
          <SplitLegend split={split} />
          <p className="mt-2 text-xs text-ink/60">
            Grupos pelas categorias padrão: Moradia, Mercado, Transporte, Saúde, Educação, Contas, Impostos e Pets são necessidades; as demais
            padrão são estilo de vida. O grupo de qualquer categoria de despesa pode ser trocado em Categorias.
          </p>
        </>
      )}
    </Card>
  );
}

export function RecurringCard({ entries, averageExpense }: { entries: Entry[]; averageExpense: number }) {
  const { data } = useFinance();
  const items = detectRecurring(entries);
  const total = items.reduce((s, r) => s + r.monthly_cents, 0);
  return (
    <Card
      id="titulo-recorrentes"
      title="Despesas recorrentes detectadas"
      subtitle="Mesma descrição em pelo menos 3 meses, com valor parecido (±25%). Inclui assinaturas, contas fixas e mensalidades; parcelas de cartão ficam de fora."
    >
      {items.length === 0 ? (
        <p className="text-sm text-ink/70">Nenhuma despesa repetida encontrada no período. Com mais meses registrados, elas aparecem aqui.</p>
      ) : (
        <>
          <p className="mb-3 text-sm">
            <strong>
              <Amount value={total} />
            </strong>{' '}
            por mês em gastos que se repetem
            {averageExpense > 0 && <> ({pct(total, averageExpense)} da despesa média)</>}, cerca de <Amount value={total * 12} /> por ano.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/70">
                  <th scope="col" className="py-1 pr-2 font-medium">Descrição</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Categoria</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Por mês</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Meses</th>
                  <th scope="col" className="py-1 text-right font-medium">Último</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {items.slice(0, 15).map((r) => (
                  <tr key={r.key}>
                    <td className="py-1 pr-2">{r.description}</td>
                    <td className="py-1 pr-2 text-ink/70">{categoryName(data.categories, r.category_id)}</td>
                    <td className="py-1 pr-2 text-right">
                      <Amount value={r.monthly_cents} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.months}</td>
                    <td className="py-1 text-right tabular-nums">{formatBusinessDate(r.last_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink/60">Sugestão: revise a lista uma vez por mês e cancele o que não usam mais; cada R$ 50/mês somam R$ 600 no ano.</p>
        </>
      )}
    </Card>
  );
}
