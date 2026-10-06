import { z } from 'zod';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import type {
  CustomerAccountBalance,
  CustomerAccountState,
  CustomerAccountType,
  CustomerLedgerEntry,
  CustomerLifecycleState,
} from './domain';
import { customerStatementQuerySchema } from './validation';
import { authorizeCustomerCommand, resolveCustomerCommandContext } from './application';
import { withTenantTransaction } from '../../platform/db/transaction';
import { deriveAccountBalance } from './domain';
import { loadAccount } from './persistence';
import { sql } from 'drizzle-orm';

export type CustomerStatementLine = Readonly<{
  entry: CustomerLedgerEntry;
  runningBalance: CustomerAccountBalance;
}>;

export type CustomerAccountStatement = Readonly<{
  accountId: string;
  balance: CustomerAccountBalance;
  lines: readonly CustomerStatementLine[];
  asOf?: string;
  nextCursor?: string;
}>;

export type CustomerAccountQuery = z.infer<typeof customerStatementQuerySchema>;

/** Query contract; implementation must execute inside trusted tenant context. */
export interface CustomerAccountQueries {
  statement(input: CustomerAccountQuery): Promise<CustomerAccountStatement>;
}

export type CustomerProductBalance = Readonly<{
  productId: string;
  productCode: string;
  productName: string;
  balanceLitres: string;
  availableLitres: string;
}>;

export type CustomerAccountSummary = Readonly<{
  accountId: string;
  accountType: CustomerAccountType;
  status: CustomerAccountState;
  currency: string;
  creditLimit: string | null;
  balance: string | null;
  availableBalance: string | null;
  availableCredit: string | null;
  reservedAmount: string;
  productBalances: readonly CustomerProductBalance[];
}>;

export type CustomerTransactionSummary = Readonly<{
  id: string;
  accountId: string;
  accountType: CustomerAccountType;
  entryType: CustomerLedgerEntry['entryType'];
  direction: CustomerLedgerEntry['direction'];
  occurredAt: string;
  businessDate: string;
  amount: string | null;
  currency: string;
  litres: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  note: string | null;
}>;

export type CustomerSummary = Readonly<{
  customerId: string;
  accountReference: string;
  displayName: string;
  status: CustomerLifecycleState;
  contactMetadata: Readonly<Record<string, string>>;
  accounts: readonly CustomerAccountSummary[];
  recentTransactions: readonly CustomerTransactionSummary[];
}>;

export type CustomerAccountsResponse = Readonly<{
  customers: readonly CustomerSummary[];
}>;

const customerAccountsQuerySchema = z.object({
  tenantId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
});

type CustomerAccountSummaryRow = {
  customer_id: string;
  account_reference: string;
  display_name: string;
  customer_status: CustomerLifecycleState;
  contact_metadata: unknown;
  account_id: string | null;
  account_type: CustomerAccountType | null;
  account_status: CustomerAccountState | null;
  currency: string | null;
  credit_limit: string | null;
  balance: string | null;
  reserved_amount: string | null;
};

type CustomerProductBalanceRow = {
  account_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  balance_litres: string;
  reserved_litres: string;
};

type CustomerTransactionRow = {
  id: string;
  account_id: string;
  account_type: CustomerAccountType;
  entry_type: CustomerLedgerEntry['entryType'];
  direction: CustomerLedgerEntry['direction'];
  occurred_at: Date | string;
  business_date: string;
  amount: string | null;
  currency: string;
  quantity_litres: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  note: string | null;
};

function subtractExact(
  left: string,
  right: string,
  policy?: (typeof DECIMAL_POLICIES)[keyof typeof DECIMAL_POLICIES],
): string {
  const result = new ExactDecimal(left).subtract(new ExactDecimal(right));
  return policy ? result.quantize(policy).toString() : result.toString();
}

function contactMetadata(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function accountSummaryFromRow(
  row: CustomerAccountSummaryRow,
  products: readonly CustomerProductBalanceRow[],
): CustomerAccountSummary | null {
  if (!row.account_id || !row.account_type || !row.account_status || !row.currency) return null;
  const balance = row.balance ?? '0';
  const reservedAmount = row.reserved_amount ?? '0';
  const accountProducts = products
    .filter((product) => product.account_id === row.account_id)
    .map((product) => ({
      productId: product.product_id,
      productCode: product.product_code,
      productName: product.product_name,
      balanceLitres: product.balance_litres,
      availableLitres: subtractExact(product.balance_litres, product.reserved_litres),
    }));

  return {
    accountId: row.account_id,
    accountType: row.account_type,
    status: row.account_status,
    currency: row.currency,
    creditLimit: row.credit_limit,
    balance: row.account_type === 'PREPAID_LITRES' ? null : balance,
    availableBalance:
      row.account_type === 'PREPAID_VALUE'
        ? subtractExact(balance, reservedAmount, DECIMAL_POLICIES.money)
        : null,
    availableCredit:
      row.account_type === 'CREDIT' && row.credit_limit !== null
        ? subtractExact(
            subtractExact(row.credit_limit, balance, DECIMAL_POLICIES.money),
            reservedAmount,
            DECIMAL_POLICIES.money,
          )
        : null,
    reservedAmount,
    productBalances: accountProducts,
  };
}

function transactionFromRow(row: CustomerTransactionRow): CustomerTransactionSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    accountType: row.account_type,
    entryType: row.entry_type,
    direction: row.direction,
    occurredAt: new Date(row.occurred_at).toISOString(),
    businessDate: row.business_date,
    amount: row.amount,
    currency: row.currency,
    litres: row.quantity_litres,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    note: row.note,
  };
}

/**
 * Read-only Phase 0 customer projection. All values are derived inside a
 * trusted tenant transaction from the existing A8 customer tables. The
 * browser receives strings for money and litres; it never performs financial
 * arithmetic or receives database access.
 */
export async function getCustomerAccountsFromRequest(
  request: Request,
  input: unknown,
): Promise<CustomerAccountsResponse> {
  const query = customerAccountsQuerySchema.parse(input);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.view');

  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<CustomerAccountSummaryRow>(sql`
      with monetary_balances as (
        select account_id,
          sum(case when direction = 'INCREASE' then amount else -amount end)::text as balance
        from app.customer_ledger_entries
        where tenant_id = ${context.tenantId}
          and account_type in ('CREDIT', 'PREPAID_VALUE')
        group by account_id
      ), active_reservations as (
        select account_id, sum(remaining_amount)::text as reserved_amount
        from app.customer_fuel_authorizations
        where tenant_id = ${context.tenantId}
          and state in ('AUTHORIZED', 'PARTIALLY_USED')
        group by account_id
      )
      select
        c.id as customer_id,
        c.account_reference,
        c.display_name,
        c.status as customer_status,
        c.contact_metadata,
        a.id as account_id,
        a.account_type,
        a.status as account_status,
        a.currency,
        a.credit_limit::text,
        mb.balance,
        ar.reserved_amount
      from app.customers c
      left join app.customer_accounts a
        on a.tenant_id = c.tenant_id and a.customer_id = c.id
      left join monetary_balances mb on mb.account_id = a.id
      left join active_reservations ar on ar.account_id = a.id
      where c.tenant_id = ${context.tenantId}
        ${query.customerId ? sql`and c.id = ${query.customerId}` : sql``}
      order by c.display_name, c.account_reference, a.account_type, a.id
    `);

    const accountIds = rows.flatMap((row) => (row.account_id ? [row.account_id] : []));
    const products = accountIds.length
      ? await transaction.execute<CustomerProductBalanceRow>(sql`
          with active_litre_reservations as (
            select account_id, product_id, sum(remaining_litres)::text as reserved_litres
            from app.customer_fuel_authorizations
            where tenant_id = ${context.tenantId}
              and state in ('AUTHORIZED', 'PARTIALLY_USED')
            group by account_id, product_id
          )
          select
            e.account_id,
            e.product_id,
            p.code as product_code,
            p.name as product_name,
            sum(case when e.direction = 'INCREASE' then e.quantity_litres else -e.quantity_litres end)::text as balance_litres,
            coalesce(r.reserved_litres, '0') as reserved_litres
          from app.customer_ledger_entries e
          join app.products p
            on p.tenant_id = e.tenant_id and p.id = e.product_id
          left join active_litre_reservations r
            on r.account_id = e.account_id and r.product_id = e.product_id
          where e.tenant_id = ${context.tenantId}
            and e.account_type = 'PREPAID_LITRES'
            and e.account_id in (${sql.join(
              accountIds.map((id) => sql`${id}`),
              sql`, `,
            )})
          group by e.account_id, e.product_id, p.code, p.name, r.reserved_litres
          order by e.account_id, p.code, e.product_id
        `)
      : [];

    const transactionRows = query.customerId
      ? await transaction.execute<CustomerTransactionRow>(sql`
          select
            e.id,
            e.account_id,
            e.account_type,
            e.entry_type,
            e.direction,
            e.occurred_at,
            e.business_date,
            e.amount::text,
            a.currency,
            e.quantity_litres::text,
            e.product_id,
            p.code as product_code,
            p.name as product_name,
            e.note
          from app.customer_ledger_entries e
          join app.customer_accounts a
            on a.tenant_id = e.tenant_id and a.id = e.account_id
          left join app.products p
            on p.tenant_id = e.tenant_id and p.id = e.product_id
          where e.tenant_id = ${context.tenantId}
            and e.customer_id = ${query.customerId}
          order by e.occurred_at desc, e.id desc
          limit 50
        `)
      : [];

    const transactionsByCustomer = query.customerId ? transactionRows.map(transactionFromRow) : [];
    const customerMap = new Map<string, CustomerSummary>();
    for (const row of rows) {
      let customer = customerMap.get(row.customer_id);
      if (!customer) {
        customer = {
          customerId: row.customer_id,
          accountReference: row.account_reference,
          displayName: row.display_name,
          status: row.customer_status,
          contactMetadata: contactMetadata(row.contact_metadata),
          accounts: [],
          recentTransactions: transactionsByCustomer,
        };
        customerMap.set(row.customer_id, customer);
      }
      const account = accountSummaryFromRow(row, products);
      if (account) {
        (customer.accounts as CustomerAccountSummary[]).push(account);
      }
    }

    return { customers: [...customerMap.values()] };
  });
}

export async function getCustomerAccountStatementFromRequest(
  request: Request,
  input: unknown,
): Promise<CustomerAccountStatement> {
  const query = customerStatementQuerySchema.parse(input);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const loaded = await loadAccount(transaction, context, query.accountId, false);
    const asOfEntries = query.asOf
      ? loaded.entries.filter((entry) => entry.occurredAt <= query.asOf!)
      : loaded.entries;
    const cursorIndex = query.cursor
      ? asOfEntries.findIndex((entry) => entry.id === query.cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = asOfEntries.slice(start, start + query.limit);
    const balance = deriveAccountBalance(loaded.account, asOfEntries);
    const lines = page.map((entry) => {
      const index = asOfEntries.findIndex((candidate) => candidate.id === entry.id);
      return {
        entry,
        runningBalance: deriveAccountBalance(loaded.account, asOfEntries.slice(0, index + 1)),
      };
    });
    const nextCursor = start + page.length < asOfEntries.length ? page.at(-1)?.id : undefined;
    return {
      accountId: query.accountId,
      balance,
      lines,
      ...(query.asOf ? { asOf: query.asOf } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  });
}
