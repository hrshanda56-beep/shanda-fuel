import 'server-only';

import { sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import type { OwnerPosition } from './contracts';
import { formatLitres, formatMoney } from './domain';

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
  const [bank] = await transaction.execute<{
    accounts_total: string | number;
    accounts_with_balance: string | number;
    total: string | null;
    oldest: string | null;
  }>(sql`
    select count(*) as accounts_total,
      count(latest.balance) as accounts_with_balance,
      sum(latest.balance)::text as total,
      min(latest.as_of_date)::text as oldest
    from app.bank_accounts a
    left join lateral (
      select s.balance, s.as_of_date from app.bank_balance_statements s
      where s.tenant_id = a.tenant_id and s.bank_account_id = a.id
      order by s.as_of_date desc, s.entered_at desc limit 1
    ) latest on true
    where a.tenant_id = ${filters.tenantId} and a.status = 'ACTIVE'
  `);
  const stock = await transaction.execute<{
    station: string;
    product: string;
    litres: string;
    value: string | null;
  }>(sql`
    select st.name as station, p.name as product,
      sum(s.quantity_litres)::text as litres,
      case when count(*) filter (where s.valuation_status <> 'VALUED' and s.quantity_litres > 0) > 0
        then null else coalesce(sum(s.inventory_value), 0)::text end as value
    from app.inventory_cost_stream_state s
    join app.stations st on st.tenant_id = s.tenant_id and st.id = s.station_id
    join app.products p on p.tenant_id = s.tenant_id and p.id = s.product_id
    where s.tenant_id = ${filters.tenantId} ${stationFilter('s', filters.stationIds)}
    group by st.name, p.name
    order by st.name, p.name
  `);
  const accountsTotal = Number(bank?.accounts_total ?? 0);
  const accountsWithBalance = Number(bank?.accounts_with_balance ?? 0);
  const complete =
    accountsTotal > 0 && accountsWithBalance === accountsTotal && bank?.total != null;
  return {
    stockByStation: stock.map((row) => ({
      stationName: row.station,
      productName: row.product,
      litres: formatLitres(row.litres),
      value: row.value === null ? null : formatMoney(row.value),
    })),
    bankBalance: {
      amount: complete ? formatMoney(bank!.total) : null,
      asOfDate: complete ? (bank!.oldest ?? null) : null,
      accountsWithBalance,
      accountsTotal,
    },
    stockValue: row.stock_value === null ? null : formatMoney(row.stock_value),
    unvaluedStockStreams: Number(row.unvalued_streams),
    unpaidExpenses: formatMoney(row.unpaid_expenses),
    expensesAwaitingApproval: {
      count: Number(row.awaiting_count),
      amount: formatMoney(row.awaiting_amount),
    },
  };
}

export function emptyOwnerPosition(): OwnerPosition {
  return {
    stockValue: '0.0000',
    unvaluedStockStreams: 0,
    unpaidExpenses: '0.0000',
    expensesAwaitingApproval: { count: 0, amount: '0.0000' },
  };
}
