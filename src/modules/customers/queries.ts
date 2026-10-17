import 'server-only';

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { DECIMAL_POLICIES, ExactDecimal, litres, money } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';
import type {
  CustomerAccount,
  CustomerAccountBalance,
  CustomerAccountState,
  CustomerAccountType,
  CustomerLedgerEntry,
  CustomerLifecycleState,
} from './domain';
import { customerStatementQuerySchema } from './validation';
import { authorizeCustomerCommand, resolveCustomerCommandContext } from './application';
import { withTenantTransaction } from '../../platform/db/transaction';
import { ledgerFromRow, type LedgerRow } from './persistence';

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
  reservedLitres: string;
  availableLitres: string;
}>;

export type CustomerAccountSummary = Readonly<{
  accountId: string;
  accountType: CustomerAccountType;
  status: CustomerAccountState;
  version: number;
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
  version: number;
  contactMetadata: Readonly<Record<string, string>>;
  monetaryExposure: string;
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
  customer_version: number | string;
  contact_metadata: unknown;
  account_id: string | null;
  account_type: CustomerAccountType | null;
  account_status: CustomerAccountState | null;
  account_version: number | string | null;
  currency: string | null;
  credit_limit: string | null;
  balance: string | null;
  reserved_amount: string | null;
  available_balance: string | null;
  available_credit: string | null;
  monetary_exposure: string | null;
};

type CustomerProductBalanceRow = {
  account_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  balance_litres: string;
  reserved_litres: string;
  available_litres: string;
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

function normalizeMoney(value: string): string {
  return new ExactDecimal(value).quantize(DECIMAL_POLICIES.money).value.toFixed(4);
}

function normalizeLitres(value: string): string {
  return new ExactDecimal(value).quantize(DECIMAL_POLICIES.litres).value.toFixed(3);
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
  if (
    !row.account_id ||
    !row.account_type ||
    !row.account_status ||
    row.account_version === null ||
    !row.currency
  ) {
    return null;
  }

  const balance = row.balance === null ? '0.0000' : normalizeMoney(row.balance);
  const reservedAmount = normalizeMoney(row.reserved_amount ?? '0');
  const accountProducts = products
    .filter((product) => product.account_id === row.account_id)
    .map((product) => ({
      productId: product.product_id,
      productCode: product.product_code,
      productName: product.product_name,
      balanceLitres: normalizeLitres(product.balance_litres),
      reservedLitres: normalizeLitres(product.reserved_litres),
      availableLitres: normalizeLitres(product.available_litres),
    }));

  return {
    accountId: row.account_id,
    accountType: row.account_type,
    status: row.account_status,
    version: Number(row.account_version),
    currency: row.currency,
    creditLimit: row.credit_limit === null ? null : normalizeMoney(row.credit_limit),
    balance: row.account_type === 'PREPAID_LITRES' ? null : balance,
    availableBalance: row.available_balance === null ? null : normalizeMoney(row.available_balance),
    availableCredit: row.available_credit === null ? null : normalizeMoney(row.available_credit),
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
    amount: row.amount === null ? null : normalizeMoney(row.amount),
    currency: row.currency,
    litres: row.quantity_litres === null ? null : normalizeLitres(row.quantity_litres),
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    note: row.note,
  };
}

/**
 * Read-only customer projection backed only by the current A8 tables.
 * Legal-entity ownership, station scope, and customer policy fields are
 * intentionally absent because they do not exist in this schema yet.
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
      ), customer_exposure as (
        select a.customer_id,
          coalesce(sum(case when a.account_type in ('CREDIT', 'PREPAID_VALUE')
            then coalesce(mb.balance::numeric, 0) else 0 end), 0)::text as monetary_exposure
        from app.customer_accounts a
        left join monetary_balances mb on mb.account_id = a.id
        where a.tenant_id = ${context.tenantId}
        group by a.customer_id
      )
      select
        c.id as customer_id,
        c.account_reference,
        c.display_name,
        c.status as customer_status,
        c.version as customer_version,
        c.contact_metadata,
        a.id as account_id,
        a.account_type,
        a.status as account_status,
        a.version as account_version,
        a.currency,
        a.credit_limit::text,
        mb.balance,
        ar.reserved_amount,
        case when a.account_type = 'PREPAID_VALUE'
          then (coalesce(mb.balance::numeric, 0) - coalesce(ar.reserved_amount::numeric, 0))::text
          else null end as available_balance,
        case when a.account_type = 'CREDIT' and a.credit_limit is not null
          then (a.credit_limit - coalesce(mb.balance::numeric, 0) - coalesce(ar.reserved_amount::numeric, 0))::text
          else null end as available_credit,
        coalesce(ce.monetary_exposure, '0') as monetary_exposure
      from app.customers c
      left join app.customer_accounts a
        on a.tenant_id = c.tenant_id and a.customer_id = c.id
      left join monetary_balances mb on mb.account_id = a.id
      left join active_reservations ar on ar.account_id = a.id
      left join customer_exposure ce on ce.customer_id = c.id
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
            coalesce(r.reserved_litres, '0') as reserved_litres,
            (sum(case when e.direction = 'INCREASE' then e.quantity_litres else -e.quantity_litres end)
              - coalesce(r.reserved_litres, 0))::text as available_litres
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

    const recentTransactions = transactionRows.map(transactionFromRow);
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
          contactMetadata: contactMetadata(row.contact_metadata),
          monetaryExposure: normalizeMoney(row.monetary_exposure ?? '0'),
          accounts: [],
          recentTransactions,
        };
        customerMap.set(row.customer_id, customer);
      }
      const account = accountSummaryFromRow(row, products);
      if (account) (customer.accounts as CustomerAccountSummary[]).push(account);
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
    type StatementAccountRow = {
      id: string;
      tenant_id: string;
      customer_id: string;
      account_type: CustomerAccount['accountType'];
      currency: CustomerAccount['currency'];
      credit_limit: string | null;
      status: CustomerAccount['status'];
    };
    type StatementRow = LedgerRow & {
      running_amount: string | null;
      running_product_balances: Array<{ productId: string; litres: string }> | null;
    };

    const accountRows = await transaction.execute<StatementAccountRow>(sql`
      select id, tenant_id, customer_id, account_type, currency, credit_limit, status
      from app.customer_accounts
      where tenant_id = ${context.tenantId} and id = ${query.accountId}
      limit 1
    `);
    const accountRow = accountRows[0];
    if (!accountRow) throw new AppError('NOT_FOUND', 'The customer account was not found');
    const account: CustomerAccount = {
      id: accountRow.id,
      tenantId: accountRow.tenant_id,
      customerId: accountRow.customer_id,
      accountType: accountRow.account_type,
      currency: accountRow.currency,
      status: accountRow.status,
      ...(accountRow.credit_limit !== null
        ? { creditLimit: money(accountRow.credit_limit, accountRow.currency) }
        : {}),
    };
    const asOfClause = query.asOf ? sql`and e.occurred_at <= ${query.asOf}::timestamptz` : sql``;
    const eligible = sql`
      select e.*,
        case when e.direction = 'INCREASE' then e.amount else -e.amount end as signed_amount,
        case when e.direction = 'INCREASE' then e.quantity_litres else -e.quantity_litres end as signed_litres
      from app.customer_ledger_entries e
      where e.tenant_id = ${context.tenantId}
        and e.account_id = ${query.accountId}
        ${asOfClause}
    `;
    const [balanceRows, statementRows] = await Promise.all([
      transaction.execute<{
        account_type: CustomerAccount['accountType'];
        product_id: string | null;
        balance_amount: string | null;
        balance_litres: string | null;
      }>(sql`
        with eligible as (${eligible})
        select account_type,
          case when account_type <> 'PREPAID_LITRES' then sum(signed_amount)::text else null end as balance_amount,
          case when account_type = 'PREPAID_LITRES' then product_id else null end as product_id,
          case when account_type = 'PREPAID_LITRES' then sum(signed_litres)::text else null end as balance_litres
        from eligible
        group by account_type, case when account_type = 'PREPAID_LITRES' then product_id else null end
        order by product_id
      `),
      transaction.execute<StatementRow>(sql`
        with eligible as (${eligible}), ordered as (
          select eligible.*,
            sum(signed_amount) over (order by occurred_at, id rows between unbounded preceding and current row)::text as running_amount,
            row_number() over (order by occurred_at, id) as sequence_no
          from eligible
        ), cursor_row as (
          select occurred_at, id
          from eligible
          where id = ${query.cursor ?? null}
          limit 1
        )
        select o.id, o.tenant_id, o.customer_id, o.account_id, o.account_type, o.entry_type,
          o.direction, o.amount, o.product_id, o.quantity_litres, o.source_type, o.source_id,
          o.source_revision_id, o.occurred_at, o.business_date, o.note, o.reason,
          o.fuel_allocation_id, o.reversal_of_entry_id, o.running_amount,
          case when o.account_type = 'PREPAID_LITRES' then (
            select coalesce(jsonb_agg(jsonb_build_object(
              'productId', balances.product_id,
              'litres', balances.balance_litres::text
            ) order by balances.product_id), '[]'::jsonb)
            from (
              select e2.product_id,
                sum(e2.signed_litres)::numeric as balance_litres
              from eligible e2
              where (e2.occurred_at, e2.id) <= (o.occurred_at, o.id)
              group by e2.product_id
            ) balances
          ) else null end as running_product_balances
        from ordered o
        left join cursor_row c on true
        where ${query.cursor ? sql`c.id is not null and (o.occurred_at, o.id) > (c.occurred_at, c.id)` : sql`true`}
        order by o.occurred_at, o.id
        limit ${query.limit + 1}
      `),
    ]);

    const hasMore = statementRows.length > query.limit;
    const page = hasMore ? statementRows.slice(0, query.limit) : statementRows;
    const lines = page.map((row) => ({
      entry: ledgerFromRow(row),
      runningBalance:
        account.accountType === 'PREPAID_LITRES'
          ? ({
              accountType: account.accountType,
              currency: account.currency,
              productBalances: (row.running_product_balances ?? []).map((item) => ({
                productId: item.productId,
                litres: litres(item.litres),
              })),
            } satisfies CustomerAccountBalance)
          : ({
              accountType: account.accountType,
              currency: account.currency,
              amount: money(row.running_amount ?? '0', account.currency),
            } satisfies CustomerAccountBalance),
    }));
    const balance: CustomerAccountBalance =
      account.accountType === 'PREPAID_LITRES'
        ? {
            accountType: account.accountType,
            currency: account.currency,
            productBalances: balanceRows
              .filter((row) => row.product_id && row.balance_litres !== null)
              .map((row) => ({ productId: row.product_id!, litres: litres(row.balance_litres!) })),
          }
        : {
            accountType: account.accountType,
            currency: account.currency,
            amount: money(balanceRows[0]?.balance_amount ?? '0', account.currency),
          };
    const nextCursor = hasMore ? page.at(-1)?.id : undefined;
    return {
      accountId: query.accountId,
      balance,
      lines,
      ...(query.asOf ? { asOf: query.asOf } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  });
}
