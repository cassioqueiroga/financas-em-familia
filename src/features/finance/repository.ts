import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Account,
  AccountBalance,
  AccountGrant,
  CardPurchase,
  CardStatement,
  Category,
  Entry,
  FinanceRepository,
  ImportPreviewItem,
  ImportResult,
  MonthlySummary,
} from './types';

const ACCOUNT_COLUMNS =
  'id, household_id, owner_user_id, name, kind, initial_balance_cents, initial_balance_date, credit_limit_cents, closing_day, due_day, is_active, version';
const CATEGORY_COLUMNS = 'id, household_id, name, kind, is_default, is_active, budget_group, version';
const PURCHASE_COLUMNS = 'id, card_account_id, description, total_cents, installment_count, purchased_on, category_id, attributed_to, status, version';

async function unwrap<T>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

/** Acesso às tabelas e RPCs financeiras. Toda autorização é feita no banco (RLS + RPC). */
export function createSupabaseFinanceRepository(client: SupabaseClient): FinanceRepository {
  return {
    listAccounts: (householdId) =>
      unwrap<Account[]>(client.from('accounts').select(ACCOUNT_COLUMNS).eq('household_id', householdId).order('name')),
    listBalances: (householdId) =>
      unwrap<AccountBalance[]>(client.from('account_balances').select('*').eq('household_id', householdId)),
    listGrants: async (accountIds) =>
      accountIds.length === 0
        ? []
        : unwrap<AccountGrant[]>(client.from('account_grants').select('account_id, user_id, access').in('account_id', accountIds)),
    createAccount: (i) =>
      unwrap<Account>(
        client.rpc('create_account', {
          p_household_id: i.householdId,
          p_name: i.name,
          p_kind: i.kind,
          p_idempotency_key: i.idempotencyKey,
          p_initial_balance_cents: i.initialBalanceCents,
          p_initial_balance_date: i.initialBalanceDate,
          p_credit_limit_cents: i.creditLimitCents,
          p_closing_day: i.closingDay,
          p_due_day: i.dueDay,
          p_share_with: i.shareWith,
          p_share_access: i.shareAccess,
        }),
      ),
    updateAccount: (i) =>
      unwrap<Account>(
        client.rpc('update_account', {
          p_account_id: i.accountId,
          p_expected_version: i.expectedVersion,
          p_name: i.name,
          p_initial_balance_cents: i.initialBalanceCents,
          p_initial_balance_date: i.initialBalanceDate,
          p_credit_limit_cents: i.creditLimitCents,
          p_closing_day: i.closingDay,
          p_due_day: i.dueDay,
        }),
      ),
    setAccountActive: (accountId, expectedVersion, active) =>
      unwrap<Account>(client.rpc('set_account_active', { p_account_id: accountId, p_expected_version: expectedVersion, p_active: active })),
    grantAccess: async (accountId, userId, access) => {
      await unwrap(client.rpc('grant_account_access', { p_account_id: accountId, p_user_id: userId, p_access: access }));
    },
    revokeAccess: async (accountId, userId) => {
      await unwrap(client.rpc('revoke_account_access', { p_account_id: accountId, p_user_id: userId }));
    },

    listCategories: (householdId) =>
      unwrap<Category[]>(client.from('categories').select(CATEGORY_COLUMNS).eq('household_id', householdId).order('name')),
    createCategory: (householdId, name, kind, idempotencyKey) =>
      unwrap<Category>(
        client.rpc('create_category', { p_household_id: householdId, p_name: name, p_kind: kind, p_idempotency_key: idempotencyKey }),
      ),
    updateCategory: (categoryId, expectedVersion, name, active) =>
      unwrap<Category>(
        client.rpc('update_category', { p_category_id: categoryId, p_expected_version: expectedVersion, p_name: name, p_active: active }),
      ),
    setCategoryGroup: (categoryId, expectedVersion, group) =>
      unwrap<Category>(client.rpc('set_category_group', { p_category_id: categoryId, p_expected_version: expectedVersion, p_group: group })),

    listEntries: (householdId, from, to) =>
      unwrap<Entry[]>(client.rpc('list_entries', { p_household_id: householdId, p_from: from, p_to: to })),
    createEntry: (i) =>
      unwrap<Entry>(
        client.rpc('create_entry', {
          p_account_id: i.accountId,
          p_kind: i.kind,
          p_amount_cents: i.amountCents,
          p_occurred_on: i.occurredOn,
          p_description: i.description,
          p_idempotency_key: i.idempotencyKey,
          p_category_id: i.categoryId,
          p_attributed_to: i.attributedTo,
          p_status: i.status,
        }),
      ),
    updateEntry: (i) =>
      unwrap<Entry>(
        client.rpc('update_entry', {
          p_entry_id: i.entryId,
          p_expected_version: i.expectedVersion,
          p_amount_cents: i.amountCents,
          p_occurred_on: i.occurredOn,
          p_description: i.description,
          p_idempotency_key: i.idempotencyKey,
          p_category_id: i.categoryId,
          p_attributed_to: i.attributedTo,
        }),
      ),
    settleEntry: (entryId, expectedVersion, paidOn) =>
      unwrap<Entry>(client.rpc('settle_entry', { p_entry_id: entryId, p_expected_version: expectedVersion, p_paid_on: paidOn })),
    cancelEntry: async (entryId, expectedVersion) => {
      await unwrap(client.rpc('cancel_entry', { p_entry_id: entryId, p_expected_version: expectedVersion }));
    },
    createTransfer: (i) =>
      unwrap<string>(
        client.rpc('create_transfer', {
          p_from_account_id: i.fromAccountId,
          p_to_account_id: i.toAccountId,
          p_amount_cents: i.amountCents,
          p_occurred_on: i.occurredOn,
          p_description: i.description,
          p_idempotency_key: i.idempotencyKey,
        }),
      ),

    listCardPurchases: (cardAccountId) =>
      unwrap<CardPurchase[]>(
        client.from('card_purchases').select(PURCHASE_COLUMNS).eq('card_account_id', cardAccountId).order('purchased_on', { ascending: false }),
      ),
    createCardPurchase: (i) =>
      unwrap<CardPurchase>(
        client.rpc('create_card_purchase', {
          p_card_account_id: i.cardAccountId,
          p_total_cents: i.totalCents,
          p_installment_count: i.installmentCount,
          p_purchased_on: i.purchasedOn,
          p_description: i.description,
          p_idempotency_key: i.idempotencyKey,
          p_category_id: i.categoryId,
          p_attributed_to: i.attributedTo,
        }),
      ),
    cancelCardPurchase: async (purchaseId, expectedVersion) => {
      await unwrap(client.rpc('cancel_card_purchase', { p_purchase_id: purchaseId, p_expected_version: expectedVersion }));
    },
    cardStatements: (cardAccountId) => unwrap<CardStatement[]>(client.rpc('card_statements', { p_card_account_id: cardAccountId })),
    payStatement: (i) =>
      unwrap<string>(
        client.rpc('pay_card_statement', {
          p_card_account_id: i.cardAccountId,
          p_statement_month: i.statementMonth,
          p_from_account_id: i.fromAccountId,
          p_amount_cents: i.amountCents,
          p_paid_on: i.paidOn,
          p_idempotency_key: i.idempotencyKey,
        }),
      ),

    monthlySummary: (householdId, month) =>
      unwrap<MonthlySummary>(client.rpc('monthly_summary', { p_household_id: householdId, p_month: `${month}-01` })),
    previewImport: (accountId, rows) => unwrap<ImportPreviewItem[]>(client.rpc('preview_import', { p_account_id: accountId, p_rows: rows })),
    importEntries: (accountId, rows, source, idempotencyKey) =>
      unwrap<ImportResult>(
        client.rpc('import_entries', { p_account_id: accountId, p_rows: rows, p_source: source, p_idempotency_key: idempotencyKey }),
      ),
  };
}
