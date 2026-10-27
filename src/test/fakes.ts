/**
 * Dublês de teste para os contratos de serviço. Usados SOMENTE em testes de
 * interface; não representam persistência e nunca são usados pela aplicação.
 */
import type { CreateHouseholdInput, Household, HouseholdRepository } from '@/features/households/types';
import type { Account, AccountGrant, Entry, FinanceRepository, MonthlySummary } from '@/features/finance/types';
import type { SharingRepository } from '@/features/sharing/types';
import type { AuthListener, AuthService, SessionUser } from '@/services/auth';

export function fakeAuth(initial: SessionUser | null): AuthService & { emit(user: SessionUser | null): void } {
  const listeners = new Set<AuthListener>();
  let current = initial;
  return {
    getCurrentUser: async () => current,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signInWithPassword(email, password) {
      if (password !== 'senha-correta') throw { code: 'invalid_credentials', message: 'Invalid login credentials' };
      current = { id: 'u-1', email };
      listeners.forEach((l) => l(current));
    },
    async signOut() {
      current = null;
      listeners.forEach((l) => l(null));
    },
    emit(user) {
      current = user;
      listeners.forEach((l) => l(user));
    },
  };
}

export function makeHousehold(overrides: Partial<Household> = {}): Household {
  return {
    id: 'h-1',
    name: 'Espaço de teste',
    kind: 'personal',
    base_currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    created_by: 'u-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

export function fakeHouseholds(impl: Partial<HouseholdRepository> = {}): HouseholdRepository & {
  createCalls: CreateHouseholdInput[];
} {
  const createCalls: CreateHouseholdInput[] = [];
  return {
    createCalls,
    list: impl.list ?? (async () => []),
    async create(input) {
      createCalls.push(input);
      if (impl.create) return impl.create(input);
      return makeHousehold({ name: input.name, kind: input.kind });
    },
  };
}

/**
 * Dublê em memória do repositório financeiro para testes de interface.
 * Implementa só o comportamento observável necessário; as regras reais
 * (saldos, permissões, idempotência) são testadas no banco (npm run test:db).
 */
export function fakeFinance(impl: Partial<FinanceRepository> = {}): FinanceRepository & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const track = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) => {
      (calls[name] ??= []).push(args.length === 1 ? args[0] : args);
      return fn(...args);
    };
  const empty = async () => [];
  const base: FinanceRepository = {
    listAccounts: empty,
    listBalances: empty,
    listGrants: empty,
    createAccount: async (i) => makeAccount({ name: i.name, kind: i.kind }),
    updateAccount: async (i) => makeAccount({ id: i.accountId, name: i.name }),
    setAccountActive: async (id, _v, active) => makeAccount({ id, is_active: active }),
    grantAccess: async () => {},
    revokeAccess: async () => {},
    listCategories: empty,
    createCategory: async (h, name, kind) => ({ id: 'c-new', household_id: h, name, kind, is_default: false, is_active: true, budget_group: null, version: 1 }),
    updateCategory: async (id, v, name, active) => ({ id, household_id: 'h-1', name, kind: 'expense', is_default: false, is_active: active, budget_group: null, version: v + 1 }),
    setCategoryGroup: async (id, v, group) => ({ id, household_id: 'h-1', name: 'Viagem', kind: 'expense', is_default: false, is_active: true, budget_group: group, version: v + 1 }),
    listEntries: empty,
    createEntry: async (i) => makeEntry({ account_id: i.accountId, kind: i.kind, amount_cents: i.amountCents, description: i.description }),
    updateEntry: async (i) => makeEntry({ id: 'e-new', amount_cents: i.amountCents, description: i.description }),
    settleEntry: async (id) => makeEntry({ id }),
    cancelEntry: async () => {},
    createTransfer: async () => 't-1',
    listCardPurchases: empty,
    createCardPurchase: async (i) => ({
      id: 'p-1',
      card_account_id: i.cardAccountId,
      description: i.description,
      total_cents: i.totalCents,
      installment_count: i.installmentCount,
      purchased_on: i.purchasedOn,
      category_id: i.categoryId,
      attributed_to: i.attributedTo,
      status: 'active',
      version: 1,
    }),
    cancelCardPurchase: async () => {},
    cardStatements: empty,
    payStatement: async () => 't-2',
    monthlySummary: async (_h, month) => makeSummary({ month: `${month}-01` }),
    previewImport: async (_a, rows) => rows.map((_, index) => ({ index, status: 'new' as const, reason: null })),
    importEntries: async (_a, rows) => ({ batch_id: 'b-1', imported: rows.length, duplicates: 0, rejected: 0, rejected_rows: [], replayed: false }),
  };
  const merged = { ...base, ...impl } as FinanceRepository;
  const tracked = Object.fromEntries(
    Object.entries(merged).map(([k, fn]) => [k, track(k, fn as (...a: unknown[]) => Promise<unknown>)]),
  ) as unknown as FinanceRepository;
  return Object.assign(tracked, { calls });
}

export function fakeSharing(impl: Partial<SharingRepository> = {}): SharingRepository {
  return {
    listMembers: async () => [{ user_id: 'u-1', role: 'owner', display_name: 'Chefe', joined_at: '2026-01-01T00:00:00Z' }],
    listInvitations: async () => [],
    createInvitation: async () => ({ invitation_id: 'i-1', code: 'ABCDEF0123456789ABCDEF0123456789', expires_at: '2026-11-02T00:00:00Z' }),
    revokeInvitation: async () => {},
    acceptInvitation: async () => makeHousehold({ id: 'h-fam', name: 'Família', kind: 'family' }),
    removeMember: async () => {},
    updateMyProfile: async () => {},
    ...impl,
  };
}

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'a-1',
    household_id: 'h-1',
    owner_user_id: 'u-1',
    name: 'Conta corrente',
    kind: 'checking',
    initial_balance_cents: 0,
    initial_balance_date: '2026-01-01',
    credit_limit_cents: null,
    closing_day: null,
    due_day: null,
    is_active: true,
    version: 1,
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e-1',
    household_id: 'h-1',
    account_id: 'a-1',
    kind: 'expense',
    status: 'posted',
    amount_cents: 1000,
    occurred_on: '2026-03-10',
    description: 'Lançamento',
    category_id: null,
    attributed_to: null,
    transfer_id: null,
    purchase_id: null,
    installment_number: null,
    installment_count: null,
    statement_month: null,
    replaces_id: null,
    import_batch_id: null,
    created_by: 'u-1',
    created_at: '2026-03-10T12:00:00Z',
    version: 1,
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<MonthlySummary> = {}): MonthlySummary {
  return {
    month: '2026-03-01',
    income_cents: 0,
    expense_cents: 0,
    result_cents: 0,
    available_cents: 0,
    card_debt_cents: 0,
    pending_expense_cents: 0,
    pending_income_cents: 0,
    statements_due_cents: 0,
    expenses_by_category: [],
    expenses_by_member: [],
    balances: [],
    pending: [],
    statements_due: [],
    ...overrides,
  };
}

/** Grant de escrita do usuário de teste u-1 em cada conta. */
export const writeGrants = (accounts: Account[]): AccountGrant[] => accounts.map((a) => ({ account_id: a.id, user_id: 'u-1', access: 'write' }));
