import 'server-only';

import { sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import type { OwnerPosition } from './contracts';
import { formatMoney, sumExact } from './domain';

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
  filters: { tenantId: string; stationIds: readonly string[]; toDate: string },
): Promise<OwnerPosition> {
  const rows = await transaction.execute<{
    stock_value: string | null;
    unvalued_streams: string | number;
    unpaid_expenses: string;
    awaiting_count: string | number;
    awaiting_amount: string;
    bank_balance: string | null;
    bank_opening_balance: string | null;
    bank_account_count: string | number;
    bank_accounts_with_opening: string | number;
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
        coalesce((select sum(greatest(e.amount - coalesce((select sum(p.amount) from app.expense_payments p
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
      ,(
        select case
          when ${filters.stationIds.length > 0} then null
          when count(ba.id) = 0 or count(bo.id) <> count(ba.id) then null
          else coalesce(sum(bo.amount + coalesce((
            select sum(alloc.amount)
            from app.bank_deposits d
            join app.bank_deposit_allocations alloc
              on alloc.tenant_id = d.tenant_id
             and alloc.station_id = d.station_id
             and alloc.deposit_id = d.id
            where d.tenant_id = ba.tenant_id
              and d.bank_account_id = ba.id
              and d.state = 'CONFIRMED'
              and to_char(d.deposited_at at time zone 'UTC', 'YYYY-MM-DD') > bo.effective_date
              and to_char(d.deposited_at at time zone 'UTC', 'YYYY-MM-DD') <= ${filters.toDate}
          ), 0)), 0)::text
        end
        from app.bank_accounts ba
        left join app.bank_opening_balances bo
          on bo.tenant_id = ba.tenant_id
         and bo.bank_account_id = ba.id
         and bo.effective_date <= ${filters.toDate}
        where ba.tenant_id = ${filters.tenantId} and ba.status = 'ACTIVE'
      ) as bank_balance,
      (
        select case
          when ${filters.stationIds.length > 0} then null
          when count(ba.id) = 0 or count(bo.id) <> count(ba.id) then null
          else coalesce(sum(bo.amount), 0)::text
        end
        from app.bank_accounts ba
        left join app.bank_opening_balances bo
          on bo.tenant_id = ba.tenant_id
         and bo.bank_account_id = ba.id
         and bo.effective_date <= ${filters.toDate}
        where ba.tenant_id = ${filters.tenantId} and ba.status = 'ACTIVE'
      ) as bank_opening_balance,
      (
        select count(*) from app.bank_accounts ba
        where ba.tenant_id = ${filters.tenantId}
          and ba.status = 'ACTIVE'
          and ${filters.stationIds.length === 0}
      ) as bank_account_count,
      (
        select count(*)
        from app.bank_accounts ba
        join app.bank_opening_balances bo
          on bo.tenant_id = ba.tenant_id
         and bo.bank_account_id = ba.id
         and bo.effective_date <= ${filters.toDate}
        where ba.tenant_id = ${filters.tenantId}
          and ba.status = 'ACTIVE'
          and ${filters.stationIds.length === 0}
      ) as bank_accounts_with_opening
  `);
  const row = rows[0];
  if (!row) return emptyOwnerPosition();
  const liabilityRows = await transaction.execute<{
    liability_account_id: string;
    liability_kind: 'TRANSPORTER' | 'OTHER';
    counterparty_name: string;
    station_id: string | null;
    balance: string;
    due_date: string | null;
  }>(sql`
    select liability_account_id, liability_kind, counterparty_name, station_id,
      sum(case when direction = 'INCREASE' then amount else -amount end)::text as balance,
      max(due_date) as due_date
    from app.approved_liability_entries
    where tenant_id = ${filters.tenantId}
      and effective_date <= ${filters.toDate}
      ${filters.stationIds.length > 0 ? sql`and station_id in (${sql.join(filters.stationIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
    group by liability_account_id, liability_kind, counterparty_name, station_id
    having sum(case when direction = 'INCREASE' then amount else -amount end) <> 0
    order by counterparty_name, liability_account_id
  `);
  return {
    stockValue: row.stock_value === null ? null : formatMoney(row.stock_value),
    unvaluedStockStreams: Number(row.unvalued_streams),
    unpaidExpenses: formatMoney(row.unpaid_expenses),
    bankBalance: row.bank_balance === null ? null : formatMoney(row.bank_balance),
    bankOpeningBalance:
      row.bank_opening_balance === null ? null : formatMoney(row.bank_opening_balance),
    bankAccountCount: Number(row.bank_account_count),
    bankAccountsWithOpening: Number(row.bank_accounts_with_opening),
    approvedLiabilities: sumExact(liabilityRows.map((liability) => liability.balance)),
    approvedLiabilityRows: liabilityRows.map((liability) => ({
      liabilityAccountId: liability.liability_account_id,
      liabilityKind: liability.liability_kind,
      counterpartyName: liability.counterparty_name,
      stationId: liability.station_id,
      balance: formatMoney(liability.balance),
      dueDate: liability.due_date,
    })),
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
    bankBalance: null,
    bankOpeningBalance: null,
    bankAccountCount: 0,
    bankAccountsWithOpening: 0,
    approvedLiabilities: '0.0000',
    approvedLiabilityRows: [],
    expensesAwaitingApproval: { count: 0, amount: '0.0000' },
  };
}
