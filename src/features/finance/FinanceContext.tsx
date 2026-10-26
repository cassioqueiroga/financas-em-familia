import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useServices } from '@/app/services';
import { useAuth } from '@/features/auth/auth-context';
import type { Household } from '@/features/households/types';
import type { Member } from '@/features/sharing/types';
import { toUserMessage } from '@/lib/errors';
import type { Account, AccountBalance, AccountGrant, Category } from './types';

/**
 * Dados do espaço selecionado (contas, saldos, categorias e membros),
 * compartilhados pelas telas financeiras. A seleção do espaço fica salva só
 * neste navegador; o acesso real é sempre decidido pelo banco.
 */
export interface SpaceData {
  accounts: Account[];
  balances: Record<string, AccountBalance>;
  grants: AccountGrant[];
  categories: Category[];
  members: Member[];
}

export interface FinanceContextValue {
  status: 'loading' | 'error' | 'ready';
  error: string | null;
  households: Household[];
  active: Household | null;
  setActiveId(id: string): void;
  data: SpaceData;
  reload(): Promise<void>;
  reloadHouseholds(): Promise<void>;
  memberName(userId: string | null): string;
}

const EMPTY: SpaceData = { accounts: [], balances: {}, grants: [], categories: [], members: [] };
const STORAGE_KEY = 'ff.activeHousehold';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Armazenamento indisponível: a escolha vale só nesta sessão.
  }
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { households: householdRepo, finance, sharing } = useServices();
  const { state: auth } = useAuth();
  const userId = auth.status === 'authenticated' ? auth.user.id : null;
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(readStored);
  const [data, setData] = useState<SpaceData>(EMPTY);
  const [status, setStatus] = useState<FinanceContextValue['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const active = useMemo(
    () => households.find((h) => h.id === activeId) ?? households.find((h) => h.kind === 'family') ?? households[0] ?? null,
    [households, activeId],
  );

  const loadSpace = useCallback(
    async (household: Household | null): Promise<SpaceData> => {
      if (!household) return EMPTY;
      const [accounts, balances, categories, members] = await Promise.all([
        finance.listAccounts(household.id),
        finance.listBalances(household.id),
        finance.listCategories(household.id),
        sharing.listMembers(household.id),
      ]);
      const grants = await finance.listGrants(accounts.map((a) => a.id));
      return {
        accounts,
        balances: Object.fromEntries(balances.map((b) => [b.account_id, b])),
        grants,
        categories,
        members,
      };
    },
    [finance, sharing],
  );

  const reloadHouseholds = useCallback(async () => {
    try {
      setHouseholds(await householdRepo.list());
      setLoaded(true);
    } catch (err) {
      setError(toUserMessage(err, 'listar espaços'));
      setStatus('error');
    }
  }, [householdRepo]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    householdRepo.list().then(
      (list) => {
        if (!alive) return;
        setHouseholds(list);
        setLoaded(true);
      },
      (err: unknown) => {
        if (!alive) return;
        setError(toUserMessage(err, 'listar espaços'));
        setStatus('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [householdRepo, userId]);

  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    loadSpace(active).then(
      (next) => {
        if (!alive) return;
        setData(next);
        setError(null);
        setStatus('ready');
      },
      (err: unknown) => {
        if (!alive) return;
        setError(toUserMessage(err, 'carregar dados do espaço'));
        setStatus('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [active, loadSpace, loaded]);

  const reload = useCallback(async () => {
    try {
      setData(await loadSpace(active));
      setError(null);
      setStatus('ready');
    } catch (err) {
      setError(toUserMessage(err, 'carregar dados do espaço'));
      setStatus('error');
    }
  }, [active, loadSpace]);

  const setActiveId = useCallback((id: string) => {
    writeStored(id);
    setStatus('loading');
    setActiveIdState(id);
  }, []);

  const memberName = useCallback(
    (id: string | null) => {
      if (!id) return 'Não atribuído';
      const m = data.members.find((x) => x.user_id === id);
      if (id === userId) return m?.display_name ? `${m.display_name} (você)` : 'Você';
      return m?.display_name ?? 'Outro membro';
    },
    [data.members, userId],
  );

  const value = useMemo<FinanceContextValue>(
    () => ({ status, error, households, active, setActiveId, data, reload, reloadHouseholds, memberName }),
    [status, error, households, active, setActiveId, data, reload, reloadHouseholds, memberName],
  );
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance precisa de <FinanceProvider>');
  return ctx;
}
