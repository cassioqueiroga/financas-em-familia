import { useState, type FormEvent } from 'react';
import { useServices } from '@/app/services';
import { Field, Select, TextInput } from '@/components/form/Field';
import { Button } from '@/components/ui/Button';
import { ErrorState, SuccessState } from '@/components/ui/StatusViews';
import { toUserMessage } from '@/lib/errors';
import { GROUP_LABEL, groupOf } from '@/features/insights/deep';
import { useFinance } from './FinanceContext';
import { PageHeader, SpaceGate, useIdempotencyKey, useWritableAccounts } from './shared';
import type { BudgetGroup, Category, CategoryKind } from './types';

export function CategoriesPage() {
  return (
    <section aria-labelledby="titulo-categorias" className="space-y-6">
      <PageHeader
        id="titulo-categorias"
        title="Categorias"
        description="Organizam receitas e despesas do espaço. Desativar não altera lançamentos antigos. O grupo de cada despesa (necessidade ou estilo de vida) alimenta a regra 50-30-20 das Análises."
      />
      <SpaceGate>
        <Categories />
      </SpaceGate>
    </section>
  );
}

function Categories() {
  const { finance } = useServices();
  const { active, data, reload } = useFinance();
  const { myRole } = useWritableAccounts();
  const canEdit = myRole !== undefined && myRole !== 'viewer';
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const key = useIdempotencyKey();

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || submitting) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const name = String(form.get('name') ?? '').trim();
    if (!name || name.length > 40) return setError('Informe um nome de até 40 caracteres.');
    setSubmitting(true);
    try {
      await finance.createCategory(active.id, name, form.get('kind') as CategoryKind, key.current);
      key.renew();
      formEl.reset();
      setError(null);
      setSuccess(`Categoria “${name}” criada.`);
      await reload();
    } catch (err) {
      setError(toUserMessage(err, 'criar categoria'));
    } finally {
      setSubmitting(false);
    }
  }

  async function update(c: Category, name: string, activeFlag: boolean) {
    try {
      await finance.updateCategory(c.id, c.version, name, activeFlag);
      setError(null);
      setSuccess('Categoria atualizada.');
      await reload();
    } catch (err) {
      setError(toUserMessage(err, 'atualizar categoria'));
    }
  }

  async function setGroup(c: Category, group: BudgetGroup | null) {
    try {
      await finance.setCategoryGroup(c.id, c.version, group);
      setError(null);
      setSuccess(`Grupo de “${c.name}” atualizado.`);
      await reload();
    } catch (err) {
      setError(toUserMessage(err, 'atualizar o grupo da categoria'));
    }
  }

  return (
    <div className="space-y-6">
      {success && <SuccessState message={success} />}
      {error && <ErrorState message={error} />}
      <div className="grid gap-4 md:grid-cols-2">
        {(['expense', 'income'] as const).map((kind) => (
          <section key={kind} aria-label={kind === 'expense' ? 'Categorias de despesa' : 'Categorias de receita'} className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">{kind === 'expense' ? 'Despesas' : 'Receitas'}</h2>
            <ul className="divide-y divide-ink/10">
              {data.categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <CategoryRow key={c.id} category={c} canEdit={canEdit} onSave={update} onGroup={setGroup} />
                ))}
            </ul>
          </section>
        ))}
      </div>
      {canEdit && (
        <form onSubmit={handleCreate} noValidate aria-labelledby="titulo-nova-categoria" className="grid gap-4 rounded-xl bg-white p-6 shadow-sm sm:grid-cols-3">
          <h2 id="titulo-nova-categoria" className="text-lg font-semibold sm:col-span-3">
            Nova categoria
          </h2>
          <Field id="cat-nome" label="Nome">
            <TextInput id="cat-nome" name="name" maxLength={40} />
          </Field>
          <Field id="cat-tipo" label="Tipo">
            <Select id="cat-tipo" name="kind" defaultValue="expense">
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={submitting}>
              Criar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function CategoryRow({
  category: c,
  canEdit,
  onSave,
  onGroup,
}: {
  category: Category;
  canEdit: boolean;
  onSave(c: Category, name: string, active: boolean): Promise<void>;
  onGroup(c: Category, group: BudgetGroup | null): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const automatic = GROUP_LABEL[groupOf(c.name)];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      {editing ? (
        <form
          className="flex flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
            void onSave(c, name, c.is_active).then(() => setEditing(false));
          }}
        >
          <label htmlFor={`cat-${c.id}`} className="sr-only">
            Novo nome de {c.name}
          </label>
          <TextInput id={`cat-${c.id}`} name="name" defaultValue={c.name} maxLength={40} className="w-auto flex-1" />
          <Button type="submit" variant="secondary">
            Salvar
          </Button>
        </form>
      ) : (
        <span className={c.is_active ? '' : 'text-ink/50 line-through'}>
          {c.name}
          {!c.is_active && <span className="sr-only"> (desativada)</span>}
          {c.kind === 'expense' && !canEdit && (
            <span className="block text-xs text-ink/60">{c.budget_group ? GROUP_LABEL[c.budget_group] : `${automatic} (automático)`}</span>
          )}
        </span>
      )}
      {c.kind === 'expense' && canEdit && !editing && (
        <>
          <label htmlFor={`grupo-${c.id}`} className="sr-only">
            Grupo de {c.name}
          </label>
          <Select
            id={`grupo-${c.id}`}
            value={c.budget_group ?? ''}
            onChange={(e) => void onGroup(c, (e.target.value || null) as BudgetGroup | null)}
            className="w-auto py-1 text-xs"
          >
            <option value="">Automático ({automatic})</option>
            <option value="essential">{GROUP_LABEL.essential}</option>
            <option value="lifestyle">{GROUP_LABEL.lifestyle}</option>
          </Select>
        </>
      )}
      {canEdit && !editing && (
        <span className="flex gap-1">
          <Button variant="ghost" className="text-sm" onClick={() => setEditing(true)}>
            Renomear
          </Button>
          <Button variant="ghost" className="text-sm" onClick={() => void onSave(c, c.name, !c.is_active)}>
            {c.is_active ? 'Desativar' : 'Reativar'}
          </Button>
        </span>
      )}
    </li>
  );
}
