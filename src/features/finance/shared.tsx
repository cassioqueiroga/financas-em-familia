import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StatusViews';
import { Select } from '@/components/form/Field';
import { addMonths, formatMonth } from '@/lib/dates';
import { MoneyError, parseBRL } from '@/lib/money';
import { useAuth } from '@/features/auth/auth-context';
import { useFinance } from './FinanceContext';
import { ACCOUNT_KIND_LABEL, type Account } from './types';

/**
 * Chave de idempotência por intenção do usuário: reutilizada em novas
 * tentativas (duplo clique, falha de rede) e renovada após sucesso.
 */
export function useIdempotencyKey() {
  const key = useRef<string>(crypto.randomUUID());
  return {
    get current() {
      return key.current;
    },
    renew() {
      key.current = crypto.randomUUID();
    },
  };
}

/** Converte o texto do campo de valor em centavos positivos ou devolve a mensagem de erro. */
export function parsePositiveAmount(raw: FormDataEntryValue | null): { cents: number } | { error: string } {
  try {
    const value = parseBRL(String(raw ?? '').trim());
    if (value <= 0) return { error: 'Informe um valor maior que zero.' };
    return { cents: value };
  } catch (err) {
    if (err instanceof MoneyError) return { error: 'Valor inválido. Use o formato 1.234,56.' };
    throw err;
  }
}

/** Seletor do espaço ativo, exibido no topo das telas financeiras. */
export function SpacePicker() {
  const { households, active, setActiveId } = useFinance();
  if (households.length <= 1) return active ? <p className="text-sm text-ink/70">Espaço: {active.name}</p> : null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="espaco-ativo" className="font-medium">
        Espaço
      </label>
      <Select id="espaco-ativo" value={active?.id ?? ''} onChange={(e) => setActiveId(e.target.value)} className="w-auto">
        {households.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name} ({h.kind === 'family' ? 'família' : 'pessoal'})
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Cabeçalho padrão das telas: título, seletor de espaço e ações. */
export function PageHeader({ id, title, description, actions }: { id: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 id={id} className="text-2xl font-bold text-brand-900">
          {title}
        </h1>
        {description && <p className="text-ink/70">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SpacePicker />
        {actions}
      </div>
    </div>
  );
}

/** Estados comuns antes de haver um espaço carregado. */
export function SpaceGate({ children }: { children: ReactNode }) {
  const { status, error, active, reload } = useFinance();
  if (status === 'loading') return <LoadingState label="Carregando dados do espaço…" />;
  if (status === 'error') {
    return (
      <ErrorState
        message={error ?? 'Não foi possível carregar os dados.'}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }
  if (!active) {
    return (
      <EmptyState
        title="Nenhum dado financeiro ainda"
        description="Comece criando o espaço da família (compartilhado) e, se quiser, um espaço pessoal (privado)."
        action={
          <Link to="/espacos" className="rounded-lg bg-brand-900 px-4 py-2 text-sm font-semibold text-white">
            Criar espaço
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}

export function MonthPicker({ month, onChange }: { month: string; onChange(month: string): void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Período">
      <Button variant="secondary" aria-label="Mês anterior" onClick={() => onChange(addMonths(month, -1))}>
        ‹
      </Button>
      <label htmlFor="mes" className="sr-only">
        Mês
      </label>
      <input
        id="mes"
        type="month"
        value={month}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-ink/30 bg-white px-3 py-2"
      />
      <Button variant="secondary" aria-label="Próximo mês" onClick={() => onChange(addMonths(month, 1))}>
        ›
      </Button>
      <span className="sr-only" aria-live="polite">
        Período selecionado: {formatMonth(month)}
      </span>
    </div>
  );
}

export function AccountOptions({ accounts, placeholder = 'Selecione…' }: { accounts: Account[]; placeholder?: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} · {ACCOUNT_KIND_LABEL[a.kind]}
        </option>
      ))}
    </>
  );
}

/** Contas em que o usuário pode lançar (concessão de escrita e papel acima de viewer). Espelha o banco só para a interface. */
export function useWritableAccounts() {
  const { data } = useFinance();
  const { state } = useAuth();
  const me = state.status === 'authenticated' ? state.user.id : null;
  const myRole = data.members.find((m) => m.user_id === me)?.role;
  const writable = (a: Account) =>
    a.is_active && myRole !== 'viewer' && data.grants.some((g) => g.account_id === a.id && g.user_id === me && g.access === 'write');
  return { me, myRole, writable, accounts: data.accounts.filter(writable) };
}
