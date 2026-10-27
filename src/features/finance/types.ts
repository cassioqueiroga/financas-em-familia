/**
 * Contratos espelhando as tabelas e RPCs financeiras
 * (supabase/migrations/20261026000200_finance_core.sql e seguintes).
 * Valores monetários são inteiros em centavos.
 */
export type AccountKind = 'checking' | 'savings' | 'cash' | 'credit_card';
export type GrantAccess = 'read' | 'write';
export type CategoryKind = 'income' | 'expense';
export type EntryKind = 'income' | 'expense' | 'transfer_out' | 'transfer_in' | 'card_charge' | 'card_payment_out' | 'card_payment_in';
export type EntryStatus = 'pending' | 'posted' | 'cancelled';

export interface Account {
  id: string;
  household_id: string;
  owner_user_id: string;
  name: string;
  kind: AccountKind;
  initial_balance_cents: number;
  initial_balance_date: string;
  credit_limit_cents: number | null;
  closing_day: number | null;
  due_day: number | null;
  is_active: boolean;
  version: number;
}

export interface AccountBalance {
  account_id: string;
  household_id: string;
  kind: AccountKind;
  balance_cents: number;
  pending_income_cents: number;
  pending_expense_cents: number;
  available_credit_cents: number | null;
}

export interface AccountGrant {
  account_id: string;
  user_id: string;
  access: GrantAccess;
}

/** Grupo 50-30-20 escolhido pelo casal; null = automático (D31). */
export type BudgetGroup = 'essential' | 'lifestyle';

export interface Category {
  id: string;
  household_id: string;
  name: string;
  kind: CategoryKind;
  is_default: boolean;
  is_active: boolean;
  budget_group: BudgetGroup | null;
  version: number;
}

export interface Entry {
  id: string;
  household_id: string;
  account_id: string;
  kind: EntryKind;
  status: EntryStatus;
  amount_cents: number;
  occurred_on: string;
  description: string;
  category_id: string | null;
  attributed_to: string | null;
  transfer_id: string | null;
  purchase_id: string | null;
  installment_number: number | null;
  installment_count: number | null;
  statement_month: string | null;
  replaces_id: string | null;
  import_batch_id: string | null;
  created_by: string;
  created_at: string;
  version: number;
}

export interface CardPurchase {
  id: string;
  card_account_id: string;
  description: string;
  total_cents: number;
  installment_count: number;
  purchased_on: string;
  category_id: string | null;
  attributed_to: string | null;
  status: 'active' | 'cancelled';
  version: number;
}

export type StatementStatus = 'open' | 'closed' | 'overdue' | 'paid';

export interface CardStatement {
  statement_month: string;
  closing_date: string;
  due_date: string;
  total_cents: number;
  paid_cents: number;
  remaining_cents: number;
  status: StatementStatus;
}

export interface MonthlySummary {
  month: string;
  income_cents: number;
  expense_cents: number;
  result_cents: number;
  available_cents: number;
  card_debt_cents: number;
  pending_expense_cents: number;
  pending_income_cents: number;
  statements_due_cents: number;
  expenses_by_category: { category_id: string | null; name: string | null; total_cents: number }[];
  expenses_by_member: { user_id: string | null; display_name: string | null; total_cents: number }[];
  balances: {
    account_id: string;
    name: string;
    kind: AccountKind;
    balance_cents: number;
    available_credit_cents: number | null;
    is_active: boolean;
  }[];
  pending: { id: string; kind: 'income' | 'expense'; amount_cents: number; occurred_on: string; description: string; account_id: string; version: number }[];
  statements_due: (CardStatement & { card_account_id: string; card_name: string })[];
}

export interface ImportRow {
  occurred_on: string;
  /** Com sinal: negativo = saída. */
  amount_cents: number;
  description: string;
  external_id: string;
}

export type ImportPreviewStatus = 'new' | 'duplicate' | 'possible_duplicate' | 'invalid';

export interface ImportPreviewItem {
  index: number;
  status: ImportPreviewStatus;
  reason: string | null;
}

export interface ImportResult {
  batch_id: string;
  imported: number;
  duplicates: number;
  rejected: number;
  rejected_rows: { index: number; reason: string }[];
  replayed: boolean;
}

export interface CreateAccountInput {
  householdId: string;
  name: string;
  kind: AccountKind;
  initialBalanceCents: number;
  initialBalanceDate: string;
  creditLimitCents: number | null;
  closingDay: number | null;
  dueDay: number | null;
  shareWith: string[];
  shareAccess: GrantAccess;
  idempotencyKey: string;
}

export interface UpdateAccountInput {
  accountId: string;
  expectedVersion: number;
  name: string;
  initialBalanceCents: number | null;
  initialBalanceDate: string | null;
  creditLimitCents: number | null;
  closingDay: number | null;
  dueDay: number | null;
}

export interface EntryInput {
  accountId: string;
  kind: 'income' | 'expense';
  amountCents: number;
  occurredOn: string;
  description: string;
  categoryId: string | null;
  attributedTo: string | null;
  status: 'pending' | 'posted';
  idempotencyKey: string;
}

export interface UpdateEntryInput {
  entryId: string;
  expectedVersion: number;
  amountCents: number;
  occurredOn: string;
  description: string;
  categoryId: string | null;
  attributedTo: string | null;
  idempotencyKey: string;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  occurredOn: string;
  description: string;
  idempotencyKey: string;
}

export interface CardPurchaseInput {
  cardAccountId: string;
  totalCents: number;
  installmentCount: number;
  purchasedOn: string;
  description: string;
  categoryId: string | null;
  attributedTo: string | null;
  idempotencyKey: string;
}

export interface PayStatementInput {
  cardAccountId: string;
  statementMonth: string;
  fromAccountId: string;
  amountCents: number;
  paidOn: string;
  idempotencyKey: string;
}

export interface FinanceRepository {
  listAccounts(householdId: string): Promise<Account[]>;
  listBalances(householdId: string): Promise<AccountBalance[]>;
  listGrants(accountIds: string[]): Promise<AccountGrant[]>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  updateAccount(input: UpdateAccountInput): Promise<Account>;
  setAccountActive(accountId: string, expectedVersion: number, active: boolean): Promise<Account>;
  grantAccess(accountId: string, userId: string, access: GrantAccess): Promise<void>;
  revokeAccess(accountId: string, userId: string): Promise<void>;

  listCategories(householdId: string): Promise<Category[]>;
  createCategory(householdId: string, name: string, kind: CategoryKind, idempotencyKey: string): Promise<Category>;
  updateCategory(categoryId: string, expectedVersion: number, name: string, active: boolean): Promise<Category>;
  setCategoryGroup(categoryId: string, expectedVersion: number, group: BudgetGroup | null): Promise<Category>;

  listEntries(householdId: string, from: string, to: string): Promise<Entry[]>;
  createEntry(input: EntryInput): Promise<Entry>;
  updateEntry(input: UpdateEntryInput): Promise<Entry>;
  settleEntry(entryId: string, expectedVersion: number, paidOn: string): Promise<Entry>;
  cancelEntry(entryId: string, expectedVersion: number): Promise<void>;
  createTransfer(input: TransferInput): Promise<string>;

  listCardPurchases(cardAccountId: string): Promise<CardPurchase[]>;
  createCardPurchase(input: CardPurchaseInput): Promise<CardPurchase>;
  cancelCardPurchase(purchaseId: string, expectedVersion: number): Promise<void>;
  cardStatements(cardAccountId: string): Promise<CardStatement[]>;
  payStatement(input: PayStatementInput): Promise<string>;

  monthlySummary(householdId: string, month: string): Promise<MonthlySummary>;
  previewImport(accountId: string, rows: ImportRow[]): Promise<ImportPreviewItem[]>;
  importEntries(accountId: string, rows: ImportRow[], source: 'ofx' | 'csv', idempotencyKey: string): Promise<ImportResult>;
}

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Carteira (dinheiro)',
  credit_card: 'Cartão de crédito',
};

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  income: 'Receita',
  expense: 'Despesa',
  transfer_out: 'Transferência enviada',
  transfer_in: 'Transferência recebida',
  card_charge: 'Compra no cartão',
  card_payment_out: 'Pagamento de fatura',
  card_payment_in: 'Pagamento recebido no cartão',
};

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  overdue: 'Vencida',
  paid: 'Paga',
};
