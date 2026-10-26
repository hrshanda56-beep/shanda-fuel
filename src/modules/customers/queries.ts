import { AppError } from '../../platform/errors';
import { resolveCustomerReadContext } from './read-context';
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
import { authorizeCustomerCommand } from './application';
import { withTenantTransaction } from '../../platform/db/transaction';
import { computeAccountAgeing, dueDateFor } from './ageing';
import { deriveAccountBalance } from './domain';
import { loadAccount } from './persistence';
import { isPermissionGranted } from '../../platform/security/permissions';
import { sql } from 'drizzle-orm';

export type CustomerStatementLine = Readonly<{
  entry: CustomerLedgerEntry;
  runningBalance: CustomerAccountBalance;
}>;

export type CustomerAccountStatement = Readonly<{
  accountId: string;
  balance: CustomerAccountBalance;
  lines: readonly CustomerStatementLine[];
  /** Present when the caller requested a monthly business-date period. */
  period?: string;
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
  version: number;
  legalEntityId: string | null;
  stationScope: 'ALL' | 'SELECTED';
  stationScopeConfigured: boolean;
  allowedStationIds: readonly string[];
  ready: boolean;
  currency: string;
  creditLimit: string | null;
  creditDays: number | null;
  /** The oldest charge still unpaid and the date it falls due (its date plus the credit days). */
  oldestUnpaidDate?: string | null;
  dueBy?: string | null;
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

export type CustomerCapabilities = Readonly<{
  recordPayment: boolean;
  topUp: boolean;
  manageCustomer: boolean;
  openAccount: boolean;
}>;

export type CustomerSummary = Readonly<{
  customerId: string;
  accountReference: string;
  displayName: string;
  status: CustomerLifecycleState;
  version: number;
  legalEntityId: string | null;
  legalEntityName: string | null;
  canManageConfiguration: boolean;
  /** What the signed-in person may do with this customer; the server still checks every command. */
  capabilities: CustomerCapabilities;
  contactMetadata: Readonly<Record<string, string>>;
  accounts: readonly CustomerAccountSummary[];
  recentTransactions: readonly CustomerTransactionSummary[];
}>;

export type CustomerAccountsResponse = Readonly<{
  customers: readonly CustomerSummary[];
  /** What the signed-in person may do across customers, so the page can offer "Add customer" even when there are none. */
  capabilities: CustomerCapabilities;
  /** Active fuels a prepaid-litres top-up can be for; only filled for a single-customer read. */
  fuelProducts: ReadonlyArray<Readonly<{ id: string; code: string; name: string }>>;
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
  customer_version: number | string;
  customer_legal_entity_id: string | null;
  customer_legal_entity_name: string | null;
  contact_metadata: unknown;
  account_id: string | null;
  account_type: CustomerAccountType | null;
  account_status: CustomerAccountState | null;
  account_version: number | string | null;
  account_legal_entity_id: string | null;
  station_scope: 'ALL' | 'SELECTED' | null;
  station_scope_configured: boolean | null;
  currency: string | null;
  credit_limit: string | null;
  credit_days: number | null;
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

type CustomerAccountStationRow = {
  account_id: string;
  station_id: string;
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
  return policy ? result.quantize(policy).value.toFixed(policy.scale) : result.toString();
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
  stationIds: readonly string[],
): CustomerAccountSummary | null {
  if (
    !row.account_id ||
    !row.account_type ||
    !row.account_status ||
    row.account_version === null ||
    !row.station_scope ||
    row.station_scope_configured === null ||
    !row.currency
  )
    return null;
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
    version: Number(row.account_version),
    legalEntityId: row.account_legal_entity_id,
    stationScope: row.station_scope,
    stationScopeConfigured: row.station_scope_configured,
    allowedStationIds: [...stationIds],
    ready: Boolean(row.account_legal_entity_id && row.station_scope_configured),
    currency: row.currency,
    creditLimit: row.credit_limit,
    creditDays: row.credit_days === null ? null : Number(row.credit_days),
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

function statementPeriodBounds(period: string): {
  fromBusinessDate: string;
  toBusinessDateExclusive: string;
} {
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    fromBusinessDate: `${yearText}-${monthText}-01`,
    toBusinessDateExclusive: `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`,
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
  const context = await resolveCustomerReadContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.view');

  const canManageConfiguration =
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode: 'customer.manage',
      requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
    }) &&
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode: 'customer.account.manage',
      requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
    });

  const may = (permissionCode: 'customer.payment.record' | 'customer.prepaid.top_up') =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
    });
  const manage = (permissionCode: 'customer.manage' | 'customer.account.manage') =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
    });
  const capabilities: CustomerCapabilities = {
    recordPayment: may('customer.payment.record'),
    topUp: may('customer.prepaid.top_up'),
    manageCustomer: manage('customer.manage'),
    openAccount: manage('customer.account.manage'),
  };

  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rowsQuery = sql`
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
        c.version as customer_version,
        c.legal_entity_id as customer_legal_entity_id,
        le.legal_name as customer_legal_entity_name,
        c.contact_metadata,
        a.id as account_id,
        a.account_type,
        a.status as account_status,
        a.version as account_version,
        a.legal_entity_id as account_legal_entity_id,
        a.station_scope,
        a.station_scope_configured,
        a.currency,
        a.credit_limit::text,
        a.credit_days,
        mb.balance,
        ar.reserved_amount
      from app.customers c
      left join app.customer_accounts a
        on a.tenant_id = c.tenant_id and a.customer_id = c.id
      left join app.legal_entities le
        on le.tenant_id = c.tenant_id and le.id = c.legal_entity_id
      left join monetary_balances mb on mb.account_id = a.id
      left join active_reservations ar on ar.account_id = a.id
      where c.tenant_id = ${context.tenantId}
        ${query.customerId ? sql`and c.id = ${query.customerId}` : sql``}
      order by c.display_name, c.account_reference, a.account_type, a.id`;
    const productsQuery = sql`
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
            and e.account_id in (select account_id from account_rows where account_id is not null)
          group by e.account_id, e.product_id, p.code, p.name, r.reserved_litres
          order by e.account_id, p.code, e.product_id`;
    const stationRowsQuery = sql`
          select account_id, station_id
          from app.customer_account_stations
          where tenant_id = ${context.tenantId}
            and account_id in (select account_id from account_rows where account_id is not null)
            and active = true
          order by account_id, station_id`;
    const transactionRowsQuery = query.customerId
      ? sql`
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
          limit 50`
      : sql`select null as unavailable where false`;
    // Every charge and payment on this customer's credit accounts, to find what is still unpaid.
    const ledgerRowsQuery = query.customerId
      ? sql`
          select e.account_id, e.id, e.direction, e.business_date, e.amount::text as amount
          from app.customer_ledger_entries e
          where e.tenant_id = ${context.tenantId}
            and e.customer_id = ${query.customerId}
            and e.account_type = 'CREDIT'
          order by e.business_date, e.occurred_at, e.id`
      : sql`select null as unavailable where false`;
    const sections = await transaction.execute<{
      rows: CustomerAccountSummaryRow[];
      products: CustomerProductBalanceRow[];
      stationRows: CustomerAccountStationRow[];
      transactionRows: CustomerTransactionRow[];
      ledgerRows?: Array<{
        account_id: string;
        id: string;
        direction: 'INCREASE' | 'DECREASE';
        business_date: string;
        amount: string;
      }>;
    }>(sql`
 with account_rows as (${rowsQuery}), product_rows as (${productsQuery}), station_rows as (${stationRowsQuery}), transaction_rows as (${transactionRowsQuery}), ledger_rows as (${ledgerRowsQuery})
 select coalesce((select json_agg(account_rows) from account_rows),'[]'::json) as rows,
 coalesce((select json_agg(product_rows) from product_rows),'[]'::json) as products,
 coalesce((select json_agg(station_rows) from station_rows),'[]'::json) as "stationRows",
 coalesce((select json_agg(transaction_rows) from transaction_rows),'[]'::json) as "transactionRows",
 coalesce((select json_agg(ledger_rows) from ledger_rows),'[]'::json) as "ledgerRows"
 `);
    const snapshot = sections[0];
    if (!snapshot)
      throw new AppError('INVARIANT_VIOLATION', 'Customer account summary was not returned');
    const { rows, products, stationRows, transactionRows, ledgerRows = [] } = snapshot;
    const stationsByAccount = new Map<string, string[]>();
    for (const station of stationRows) {
      const current = stationsByAccount.get(station.account_id) ?? [];
      current.push(station.station_id);
      stationsByAccount.set(station.account_id, current);
    }

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
          version: Number(row.customer_version),
          legalEntityId: row.customer_legal_entity_id,
          legalEntityName: row.customer_legal_entity_name,
          canManageConfiguration,
          capabilities,
          contactMetadata: contactMetadata(row.contact_metadata),
          accounts: [],
          recentTransactions: transactionsByCustomer,
        };
        customerMap.set(row.customer_id, customer);
      }
      const account = accountSummaryFromRow(
        row,
        products,
        stationsByAccount.get(row.account_id ?? '') ?? [],
      );
      if (account) {
        if (account.accountType === 'CREDIT') {
          const lines = ledgerRows.filter((line) => line.account_id === account.accountId);
          if (lines.length > 0) {
            const lastDate = lines.reduce(
              (latest, line) => (line.business_date > latest ? line.business_date : latest),
              lines[0]!.business_date,
            );
            const oldest = computeAccountAgeing(
              lines.map((line) => ({
                id: line.id,
                businessDate: line.business_date,
                direction: line.direction,
                amount: line.amount,
              })),
              { asAt: lastDate },
            ).oldestOpenChargeDate;
            (customer.accounts as CustomerAccountSummary[]).push({
              ...account,
              oldestUnpaidDate: oldest,
              dueBy: oldest ? dueDateFor(oldest, account.creditDays) : null,
            });
            continue;
          }
        }
        (customer.accounts as CustomerAccountSummary[]).push(account);
      }
    }

    const fuelProducts = query.customerId
      ? [
          ...(await transaction.execute<{ id: string; code: string; name: string }>(sql`
            select id, code, name
            from app.products
            where tenant_id = ${context.tenantId} and status = 'ACTIVE'
            order by code`)),
        ]
      : [];

    return { customers: [...customerMap.values()], capabilities, fuelProducts };
  });
}

export async function getCustomerAccountStatementFromRequest(
  request: Request,
  input: unknown,
): Promise<CustomerAccountStatement> {
  const query = customerStatementQuerySchema.parse(input);
  const context = await resolveCustomerReadContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const loaded = await loadAccount(transaction, context, query.accountId, false);
    const entriesThroughAsOf = query.asOf
      ? loaded.entries.filter((entry) => entry.occurredAt <= query.asOf!)
      : loaded.entries;
    const entriesForStatement = query.period
      ? (() => {
          const bounds = statementPeriodBounds(query.period);
          return entriesThroughAsOf.filter(
            (entry) =>
              entry.businessDate >= bounds.fromBusinessDate &&
              entry.businessDate < bounds.toBusinessDateExclusive,
          );
        })()
      : entriesThroughAsOf;
    const balanceEntries = query.period
      ? (() => {
          const bounds = statementPeriodBounds(query.period);
          return loaded.entries.filter(
            (entry) => entry.businessDate < bounds.toBusinessDateExclusive,
          );
        })()
      : entriesThroughAsOf;
    const cursorIndex = query.cursor
      ? entriesForStatement.findIndex((entry) => entry.id === query.cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = entriesForStatement.slice(start, start + query.limit);
    const balance = deriveAccountBalance(loaded.account, balanceEntries);
    const lines = page.map((entry) => {
      const index = balanceEntries.findIndex((candidate) => candidate.id === entry.id);
      return {
        entry,
        runningBalance: deriveAccountBalance(loaded.account, balanceEntries.slice(0, index + 1)),
      };
    });
    const nextCursor =
      start + page.length < entriesForStatement.length ? page.at(-1)?.id : undefined;
    return {
      accountId: query.accountId,
      balance,
      lines,
      ...(query.period ? { period: query.period } : {}),
      ...(query.asOf ? { asOf: query.asOf } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  });
}
