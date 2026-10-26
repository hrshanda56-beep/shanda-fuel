import 'server-only';

import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import type { OwnerPosition } from './contracts';
import { readSupplierExposure } from '../creditors/purchasing-queries';
import { formatMoney } from './domain';

type PositionTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function stationFilter(alias: string, stationIds: readonly string[]) {
  return stationIds.length > 0
    ? sql`and ${sql.raw(`${alias}.station_id`)} in (${sql.join(
        stationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
}

/**
 * Stock value, unpaid expenses and expenses awaiting approval for the tenant, optionally narrowed
 * to stations. Runs inside the caller's tenant transaction so row-level security still applies.
 * Money stays text from the database to the contract.
 */
export async function readOwnerPosition(
  transaction: PositionTransaction,
  filters: { tenantId: string; stationIds: readonly string[] },
  legalEntityIds: readonly string[] = [],
): Promise<OwnerPosition> {
  const rows = await transaction.execute<{
    stock_value: string | null;
    unvalued_streams: string | number;
    unpaid_expenses: string;
    awaiting_count: string | number;
    awaiting_amount: string;
  }>(sql`
    select
      (select case when count(*) filter (where s.valuation_status <> 'VALUED' and s.quantity_litres > 0) > 0
          then null else coalesce(sum(s.inventory_value) filter (where s.valuation_status = 'VALUED'), 0)::text end
        from app.inventory_cost_stream_state s
        where s.tenant_id = ${filters.tenantId} ${stationFilter('s', filters.stationIds)}) as stock_value,
      (select count(*) from app.inventory_cost_stream_state s
        where s.tenant_id = ${filters.tenantId} ${stationFilter('s', filters.stationIds)}
          and s.valuation_status <> 'VALUED' and s.quantity_litres > 0) as unvalued_streams,
      (
        coalesce((select sum(e.amount - coalesce((select sum(p.amount) from app.expense_payments p
            where p.tenant_id = e.tenant_id and p.expense_id = e.id and p.state = 'RECORDED'), 0))
          from app.expenses e
          where e.tenant_id = ${filters.tenantId} and e.state = 'POSTED' ${stationFilter('e', filters.stationIds)}), 0)
        +
        coalesce((select sum(greatest(
            coalesce((select sum(x.amount) from app.recurring_cost_recognitions x
              where x.tenant_id = r.tenant_id and x.period_id = r.id and x.state = 'RECOGNIZED'), 0)
            - coalesce((select sum(p.amount) from app.expense_payments p
              where p.tenant_id = r.tenant_id and p.recurring_period_id = r.id and p.state = 'RECORDED'), 0), 0))
          from app.recurring_cost_periods r
          where r.tenant_id = ${filters.tenantId} ${stationFilter('r', filters.stationIds)}), 0)
      )::text as unpaid_expenses,
      (select count(*) from app.expenses e
        where e.tenant_id = ${filters.tenantId} and e.state = 'SUBMITTED' ${stationFilter('e', filters.stationIds)}) as awaiting_count,
      coalesce((select sum(e.amount) from app.expenses e
        where e.tenant_id = ${filters.tenantId} and e.state = 'SUBMITTED' ${stationFilter('e', filters.stationIds)}), 0)::text as awaiting_amount
  `);
  const row = rows[0];
  if (!row) return emptyOwnerPosition();
  const [bank, receivedNotInvoiced] = await Promise.all([
    readBank(transaction, filters.tenantId, legalEntityIds),
    readReceivedNotInvoiced(transaction, filters.tenantId, legalEntityIds),
  ]);
  return {
    bank,
    receivedNotInvoiced,
    stockValue: row.stock_value === null ? null : formatMoney(row.stock_value),
    unvaluedStockStreams: Number(row.unvalued_streams),
    unpaidExpenses: formatMoney(row.unpaid_expenses),
    expensesAwaitingApproval: {
      count: Number(row.awaiting_count),
      amount: formatMoney(row.awaiting_amount),
    },
  };
}

async function readBank(
  transaction: PositionTransaction,
  tenantId: string,
  legalEntityIds: readonly string[],
): Promise<NonNullable<OwnerPosition['bank']>> {
  if (legalEntityIds.length === 0) {
    return { balance: null, asOf: null, accountCount: 0, accountsWithoutBalance: 0 };
  }
  const rows = await transaction.execute<{
    accounts: string | number;
    with_balance: string | number;
    total: string | null;
    as_of: string | null;
  }>(sql`
    with latest as (
      select distinct on (b.id) b.id, bal.amount, bal.as_of_date
      from app.bank_accounts b
      left join app.bank_account_balances bal
        on bal.tenant_id = b.tenant_id and bal.bank_account_id = b.id
      where b.tenant_id = ${tenantId} and b.status = 'ACTIVE'
        and b.legal_entity_id in (${sql.join(
          legalEntityIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      order by b.id, bal.as_of_date desc nulls last, bal.recorded_at desc nulls last
    )
    select count(*) as accounts, count(amount) as with_balance,
      sum(amount)::text as total, min(as_of_date)::text as as_of
    from latest
  `);
  const row = rows[0];
  const accountCount = Number(row?.accounts ?? 0);
  const withBalance = Number(row?.with_balance ?? 0);
  const complete = accountCount > 0 && withBalance === accountCount;
  return {
    balance: complete && row?.total != null ? formatMoney(row.total) : null,
    asOf: complete ? (row?.as_of ?? null) : null,
    accountCount,
    accountsWithoutBalance: accountCount - withBalance,
  };
}

async function readReceivedNotInvoiced(
  transaction: PositionTransaction,
  tenantId: string,
  legalEntityIds: readonly string[],
): Promise<NonNullable<OwnerPosition['receivedNotInvoiced']>> {
  const today = new Date().toISOString().slice(0, 10);
  let value = new Decimal(0);
  let unpriced = new Decimal(0);
  for (const legalEntityId of legalEntityIds) {
    const exposure = await readSupplierExposure(transaction, {
      tenantId,
      legalEntityId,
      asOf: today,
    });
    value = value.add(exposure.totals.unbilledValue);
    unpriced = unpriced.add(exposure.totals.unpricedUnbilledLitres);
  }
  return {
    value: unpriced.isZero() ? formatMoney(value.toFixed(4)) : null,
    unpricedLitres: unpriced.toFixed(3),
  };
}

export function emptyOwnerPosition(): OwnerPosition {
  return {
    stockValue: '0.0000',
    unvaluedStockStreams: 0,
    unpaidExpenses: '0.0000',
    expensesAwaitingApproval: { count: 0, amount: '0.0000' },
    bank: { balance: null, asOf: null, accountCount: 0, accountsWithoutBalance: 0 },
    receivedNotInvoiced: { value: '0.0000', unpricedLitres: '0.000' },
  };
}
