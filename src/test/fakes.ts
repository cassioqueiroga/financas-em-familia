/**
 * Dublês de teste para os contratos de serviço. Usados SOMENTE em testes de
 * interface; não representam persistência e nunca são usados pela aplicação.
 */
import type { CreateHouseholdInput, Household, HouseholdRepository } from '@/features/households/types';
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
