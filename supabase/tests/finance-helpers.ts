import { randomUUID } from 'node:crypto';
import { asUser, createHousehold, createUser, pool } from './helpers';

/** Executa uma consulta como usuário autenticado e devolve as linhas. */
export async function q<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return asUser(user, async (db) => (await db.query(sql, params)).rows as T[]);
}

export async function one<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q<T>(user, sql, params);
  return rows[0]!;
}

export interface Couple {
  family: string;
  chefe: string;
  esposa: string;
  chefePersonal: string;
  esposaPersonal: string;
}

/** Casal: cada um com espaço pessoal; espaço da família com a esposa entrando por convite. */
export async function couple(role: 'admin' | 'member' | 'viewer' = 'member'): Promise<Couple> {
  const [chefe, esposa] = await Promise.all([createUser(), createUser()]);
  const family = await createHousehold(chefe, 'Família', 'family');
  const chefePersonal = await createHousehold(chefe, 'Pessoal', 'personal');
  const esposaPersonal = await createHousehold(esposa, 'Pessoal', 'personal');
  const invite = await one<{ code: string }>(chefe, 'select * from public.create_household_invitation($1, $2)', [family.id, role]);
  await q(esposa, 'select public.accept_household_invitation($1)', [invite.code]);
  return { family: family.id, chefe, esposa, chefePersonal: chefePersonal.id, esposaPersonal: esposaPersonal.id };
}

export interface AccountOptions {
  kind?: 'checking' | 'savings' | 'cash' | 'credit_card';
  initial?: number;
  date?: string;
  shareWith?: string[];
  access?: 'read' | 'write';
  limit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
  name?: string;
}

export async function createAccount(user: string, householdId: string, opts: AccountOptions = {}) {
  const kind = opts.kind ?? 'checking';
  const card = kind === 'credit_card';
  return one<{ id: string; version: number; household_id: string; owner_user_id: string; is_active: boolean }>(
    user,
    `select * from public.create_account(
       p_household_id => $1, p_name => $2, p_kind => $3, p_idempotency_key => $4,
       p_initial_balance_cents => $5, p_initial_balance_date => $6, p_credit_limit_cents => $7,
       p_closing_day => $8, p_due_day => $9, p_share_with => $10, p_share_access => $11)`,
    [
      householdId,
      opts.name ?? `Conta ${randomUUID().slice(0, 8)}`,
      kind,
      randomUUID(),
      opts.initial ?? 0,
      opts.date ?? '2026-01-01',
      card ? (opts.limit ?? 500000) : null,
      card ? (opts.closingDay ?? 10) : null,
      card ? (opts.dueDay ?? 20) : null,
      opts.shareWith ?? [],
      opts.access ?? 'write',
    ],
  );
}

export async function categoryId(user: string, householdId: string, name: string): Promise<string> {
  const row = await one<{ id: string }>(user, 'select id from public.categories where household_id = $1 and name = $2', [
    householdId,
    name,
  ]);
  return row.id;
}

export interface EntryOptions {
  kind?: 'income' | 'expense';
  amount?: number;
  date?: string;
  description?: string;
  category?: string | null;
  attributedTo?: string | null;
  status?: 'pending' | 'posted';
  key?: string;
}

export async function createEntry(user: string, accountId: string, opts: EntryOptions = {}) {
  return one<{ id: string; version: number; status: string; amount_cents: string; kind: string }>(
    user,
    `select * from public.create_entry(
       p_account_id => $1, p_kind => $2, p_amount_cents => $3, p_occurred_on => $4, p_description => $5,
       p_idempotency_key => $6, p_category_id => $7, p_attributed_to => $8, p_status => $9)`,
    [
      accountId,
      opts.kind ?? 'expense',
      opts.amount ?? 1000,
      opts.date ?? '2026-03-10',
      opts.description ?? 'Lançamento de teste',
      opts.key ?? randomUUID(),
      opts.category ?? null,
      opts.attributedTo ?? null,
      opts.status ?? 'posted',
    ],
  );
}

export async function balance(user: string, accountId: string): Promise<number | undefined> {
  const rows = await q<{ balance_cents: string }>(user, 'select balance_cents from public.account_balances where account_id = $1', [
    accountId,
  ]);
  return rows[0] ? Number(rows[0].balance_cents) : undefined;
}

export { createUser, pool, randomUUID };
