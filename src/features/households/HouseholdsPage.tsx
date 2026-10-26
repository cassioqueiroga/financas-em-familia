import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useServices } from '@/app/services';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '@/components/ui/StatusViews';
import { useFinance } from '@/features/finance/FinanceContext';
import { toUserMessage } from '@/lib/errors';
import type { Household } from './types';
import { createHouseholdSchema } from './validation';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: Household[] };

const KIND_LABEL: Record<Household['kind'], string> = { personal: 'Pessoal', family: 'Família' };

export function HouseholdsPage() {
  const { households } = useServices();
  const { reloadHouseholds } = useFinance();
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Uma chave por intenção de criação: repetir o envio (duplo clique, nova
  // tentativa após falha de rede) reutiliza a mesma chave e não duplica.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const fetchList = useCallback(
    (): Promise<ListState> =>
      households.list().then(
        (items): ListState => ({ status: 'ready', items }),
        (err: unknown): ListState => ({ status: 'error', message: toUserMessage(err, 'listar espaços') }),
      ),
    [households],
  );

  const load = useCallback(async () => {
    setList({ status: 'loading' });
    setList(await fetchList());
  }, [fetchList]);

  useEffect(() => {
    let active = true;
    void fetchList().then((next) => active && setList(next));
    return () => {
      active = false;
    };
  }, [fetchList]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setSuccess(null);
    const parsed = createHouseholdSchema.safeParse({ name: form.get('name'), kind: form.get('kind') });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await households.create({ ...parsed.data, idempotencyKey: idempotencyKey.current });
      idempotencyKey.current = crypto.randomUUID();
      formEl.reset();
      setSuccess(`Espaço “${created.name}” criado.`);
      await Promise.all([load(), reloadHouseholds()]);
    } catch (err) {
      setFormError(toUserMessage(err, 'criar espaço'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="titulo-espacos" className="space-y-6">
      <div>
        <h1 id="titulo-espacos" className="text-2xl font-bold text-brand-900">
          Espaços
        </h1>
        <p className="text-ink/70">Cada espaço isola um conjunto de finanças: pessoal ou da família.</p>
      </div>

      {list.status === 'loading' && <LoadingState label="Carregando espaços…" />}
      {list.status === 'error' && (
        <ErrorState
          message={list.message}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Tentar de novo
            </Button>
          }
        />
      )}
      {list.status === 'ready' && list.items.length === 0 && (
        <EmptyState title="Você ainda não tem espaços" description="Crie um espaço pessoal ou familiar abaixo." />
      )}
      {list.status === 'ready' && list.items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.items.map((h) => (
            <li key={h.id} className="rounded-xl bg-white p-4 shadow-sm">
              <p className="font-semibold">{h.name}</p>
              <p className="text-sm text-ink/70">
                {KIND_LABEL[h.kind]} · {h.base_currency}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm" noValidate aria-labelledby="titulo-novo">
        <h2 id="titulo-novo" className="text-lg font-semibold">
          Novo espaço
        </h2>
        {success && <SuccessState message={success} />}
        {formError && <ErrorState message={formError} />}
        <div className="space-y-1">
          <label htmlFor="household-name" className="block text-sm font-medium">
            Nome
          </label>
          <input id="household-name" name="name" maxLength={80} className="w-full rounded-lg border border-ink/30 px-3 py-2" />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Tipo</legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input type="radio" name="kind" value="personal" defaultChecked /> Pessoal
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="kind" value="family" /> Família
          </label>
        </fieldset>
        <Button type="submit" loading={submitting}>
          Criar espaço
        </Button>
      </form>
    </section>
  );
}
