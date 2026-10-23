import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../platform/db';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { authorizeCustomerCommand } from './application';
import { resolveCustomerReadContext } from './read-context';
import {
  assertBenefitMonth,
  benefitMonthEnd,
  benefitMonthStart,
  computeBenefitCost,
  isBenefitMonthClosed,
  staffBenefitExpenseReference,
  type BenefitCostResult,
} from './staff-benefit-expense';

type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];

export type StaffBenefitMonth = Readonly<{
  accountId: string;
  stationId: string;
  stationName: string;
  staffName: string;
  month: string;
  /** Today in the station's own time zone. */
  stationToday: string;
  closed: boolean;
  reference: string;
  cost: BenefitCostResult;
  /** An active expense already covers this account, station and month. */
  existingExpense: Readonly<{ id: string; state: string }> | null;
}>;

/**
 * Everything needed to show or post one account's month at one station. Used by the preview page
 * and again, inside the posting transaction, so the figure that is posted is recomputed from the
 * records and never taken from the browser. Month boundaries follow the station's time zone.
 */
export async function loadStaffBenefitMonth(
  transaction: Executor,
  input: { tenantId: string; stationId: string; accountId: string; month: string },
): Promise<StaffBenefitMonth> {
  const month = assertBenefitMonth(input.month);
  const head = await transaction.execute<{
    station_name: string;
    timezone: string | null;
    today: string | null;
    staff_name: string;
  }>(sql`
    select s.name as station_name, s.timezone,
           to_char(now() at time zone s.timezone, 'YYYY-MM-DD') as today,
           t.staff_name
    from app.stations s
    join app.customer_accounts a
      on a.tenant_id = s.tenant_id and a.legal_entity_id = s.legal_entity_id
    join app.customer_staff_benefit_terms t
      on t.tenant_id = a.tenant_id and t.account_id = a.id
    where s.tenant_id = ${input.tenantId} and s.id = ${input.stationId}
      and a.id = ${input.accountId}
  `);
  const row = head[0];
  if (!row) {
    throw new AppError(
      'NOT_FOUND',
      'That staff benefit account was not found for this station’s company.',
    );
  }
  if (!row.timezone || !row.today) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'This station has no time zone on file, so the month cannot be worked out.',
    );
  }
  const stationToday = row.today;
  const closed = isBenefitMonthClosed(month, stationToday);
  const reference = staffBenefitExpenseReference(input.accountId, month);
  const [fuel, costs, existing] = await Promise.all([
    transaction.execute<{
      product_id: string;
      product_name: string;
      litres: string;
      sold_value: string;
    }>(sql`
      select a.product_id, p.name as product_name,
             sum(a.used_litres)::text as litres, sum(a.used_amount)::text as sold_value
      from app.customer_fuel_authorizations a
      join app.products p on p.tenant_id = a.tenant_id and p.id = a.product_id
      where a.tenant_id = ${input.tenantId} and a.account_id = ${input.accountId}
        and a.station_id = ${input.stationId} and a.used_litres > 0
        and to_char(a.requested_at at time zone ${row.timezone}, 'YYYY-MM') = ${month}
      group by a.product_id, p.name
      order by p.name
    `),
    transaction.execute<{ product_id: string; litres: string; cogs: string }>(sql`
      select a.product_id,
             sum(a.sale_quantity_litres)::text as litres,
             sum(a.original_cogs + coalesce(d.delta, 0))::text as cogs
      from app.inventory_sale_cost_attributions a
      left join lateral (
        select sum(l.cogs_delta) as delta
        from app.inventory_cost_revaluation_lines l
        join app.inventory_cost_revaluations r
          on r.tenant_id = l.tenant_id and r.id = l.revaluation_id and r.status = 'POSTED'
        where l.tenant_id = a.tenant_id and l.sale_attribution_id = a.id
      ) d on true
      where a.tenant_id = ${input.tenantId} and a.station_id = ${input.stationId}
        and a.business_date >= ${benefitMonthStart(month)}
        and a.business_date <= ${benefitMonthEnd(month)}
      group by a.product_id
    `),
    transaction.execute<{ id: string; state: string }>(sql`
      select id, state from app.expenses
      where tenant_id = ${input.tenantId} and station_id = ${input.stationId}
        and reference = ${reference} and state not in ('REJECTED', 'REVERSED')
      limit 1
    `),
  ]);
  return {
    accountId: input.accountId,
    stationId: input.stationId,
    stationName: row.station_name,
    staffName: row.staff_name,
    month,
    stationToday,
    closed,
    reference,
    cost: computeBenefitCost(
      fuel.map((entry) => ({
        productId: entry.product_id,
        productName: entry.product_name,
        litres: entry.litres,
        soldValue: entry.sold_value,
      })),
      costs.map((entry) => ({
        productId: entry.product_id,
        costedLitres: entry.litres,
        cogs: entry.cogs,
      })),
    ),
    existingExpense: existing[0] ?? null,
  };
}

const previewSchema = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

/**
 * The month-end preview for every staff benefit account at a station, for owners and
 * administrators. Nothing is written.
 */
export async function getStaffBenefitExpensePreviewFromRequest(
  request: Request,
  input: unknown,
): Promise<readonly StaffBenefitMonth[]> {
  const query = previewSchema.parse(input);
  const context = await resolveCustomerReadContext({
    request,
    requestedTenantId: query.tenantId,
    stationId: query.stationId,
  });
  authorizeCustomerCommand(context, 'customer.account.adjust');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const accounts = await transaction.execute<{ account_id: string }>(sql`
      select t.account_id
      from app.customer_staff_benefit_terms t
      join app.customer_accounts a on a.tenant_id = t.tenant_id and a.id = t.account_id
      join app.stations s on s.tenant_id = a.tenant_id and s.legal_entity_id = a.legal_entity_id
      where t.tenant_id = ${query.tenantId} and s.id = ${query.stationId}
      order by t.staff_name, t.account_id
    `);
    const months: StaffBenefitMonth[] = [];
    for (const account of accounts) {
      months.push(
        await loadStaffBenefitMonth(transaction, {
          tenantId: query.tenantId,
          stationId: query.stationId,
          accountId: account.account_id,
          month: query.month,
        }),
      );
    }
    return months;
  });
}
