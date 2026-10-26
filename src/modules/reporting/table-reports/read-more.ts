import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { readCanonicalRevenue, readRestatedCogs } from '../../profitability/query';
import { TABLE_REPORT_ROW_LIMIT } from './definitions';
import type { TableReportReader } from './read';
import { equalsClause, reconciliationNarrowing } from './read-extra';
import { buildStationDailyRows, type DailyReportExpense } from './station-daily-report';
import { stockVarianceRow, tankWithoutDipRow } from './stock-variance';

const limit = sql.raw(String(TABLE_REPORT_ROW_LIMIT + 1));

function stationClause(alias: string, stationIds: readonly string[]): SQL {
  if (stationIds.length === 0) return sql``;
  return sql`and ${sql.raw(`${alias}.station_id`)} in (${sql.join(
    stationIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/** Sales are only counted once the day has been approved. */
const APPROVED_STATES = sql`('APPROVED', 'POSTED', 'LOCKED')`;

export const readSalesByPeriod: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    date: string;
    week_starting: string;
    month: string;
    station: string;
    product: string;
    litres: string;
    sales: string;
  }>(sql`
    select bd.business_date::text as date,
      to_char(date_trunc('week', bd.business_date::date), 'YYYY-MM-DD') as week_starting,
      to_char(bd.business_date::date, 'YYYY-MM') as month,
      st.name as station, p.name as product,
      sum(mr.litres_sold)::text as litres, sum(mr.sales_value)::text as sales
    from app.reconciliation_meter_readings mr
    join app.reconciliations r
      on r.tenant_id = mr.tenant_id and r.station_id = mr.station_id and r.id = mr.reconciliation_id
    join app.stations st on st.tenant_id = r.tenant_id and st.id = r.station_id
    join app.station_business_days bd
      on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
    join app.products p on p.tenant_id = mr.tenant_id and p.id = mr.product_id
    left join app.shifts sh
      on sh.tenant_id = r.tenant_id and sh.station_id = r.station_id and sh.id = r.shift_id
    where r.tenant_id = ${filters.tenantId}
      and r.state in ${APPROVED_STATES}
      and bd.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('r', filters.stationIds)}
      ${equalsClause('mr.product_id::text', filters.productId)}
      ${equalsClause('sh.shift_template_id::text', filters.shiftTemplateId)}
      ${reconciliationNarrowing('r', filters)}
    group by bd.business_date, st.name, p.name
    order by bd.business_date desc, st.name, p.name
    limit ${limit}
  `);
  return rows.map((row) => ({
    date: row.date,
    weekStarting: row.week_starting,
    month: row.month,
    station: row.station,
    product: row.product,
    litres: row.litres,
    sales: row.sales,
  }));
};

export const readStockVariance: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    date: string;
    station: string;
    tank: string;
    product: string;
    physical: string;
    expected: string;
    variance: string;
    tolerance: string | null;
    day_approved: boolean;
  }>(sql`
    select d.business_date::text as date, s.name as station, t.code as tank, p.name as product,
      d.physical_litres::text as physical,
      coalesce(book.expected, 0)::text as expected,
      (d.physical_litres - coalesce(book.expected, 0))::text as variance,
      t.acceptable_variance_litres::text as tolerance,
      exists (
        select 1 from app.reconciliation_dip_refs ref
        join app.reconciliations r
          on r.tenant_id = ref.tenant_id and r.station_id = ref.station_id
         and r.id = ref.reconciliation_id
        where ref.tenant_id = d.tenant_id and ref.station_id = d.station_id and ref.dip_id = d.id
          and r.state in ${APPROVED_STATES}
      ) as day_approved
    from app.tank_dips d
    join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
    join app.tanks t on t.tenant_id = d.tenant_id and t.station_id = d.station_id and t.id = d.tank_id
    join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
    left join lateral (
      select sum(m.quantity_litres) as expected from app.inventory_movements m
      where m.tenant_id = d.tenant_id and m.station_id = d.station_id
        and m.tank_id = d.tank_id and m.product_id = t.product_id
        and m.effective_at <= d.measured_at
    ) book on true
    where d.tenant_id = ${filters.tenantId}
      and d.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('d', filters.stationIds)}
      ${equalsClause('t.product_id::text', filters.productId)}
    order by d.business_date desc, s.name, t.code, d.measured_at desc
    limit ${limit}
  `);
  const idle = await transaction.execute<{
    station: string;
    tank: string;
    product: string;
    tolerance: string | null;
  }>(sql`
    select s.name as station, t.code as tank, p.name as product,
      t.acceptable_variance_litres::text as tolerance
    from app.tanks t
    join app.stations s on s.tenant_id = t.tenant_id and s.id = t.station_id
    join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
    where t.tenant_id = ${filters.tenantId} and t.status = 'ACTIVE'
      ${stationClause('t', filters.stationIds)}
      ${equalsClause('t.product_id::text', filters.productId)}
      and not exists (
        select 1 from app.tank_dips d
        where d.tenant_id = t.tenant_id and d.station_id = t.station_id and d.tank_id = t.id
          and d.business_date between ${filters.fromDate} and ${filters.toDate})
    order by s.name, t.code
  `);
  return [
    ...rows.map((row) =>
      stockVarianceRow({
        date: row.date,
        station: row.station,
        tank: row.tank,
        product: row.product,
        physical: row.physical,
        expected: row.expected,
        variance: row.variance,
        tolerance: row.tolerance,
        dayApproved: row.day_approved,
      }),
    ),
    ...idle.map(tankWithoutDipRow),
  ];
};

export const readStationDailyReport: TableReportReader = async (transaction, filters) => {
  const range = {
    tenantId: filters.tenantId,
    stationIds: filters.stationIds,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
  };
  const [revenue, cogs] = await Promise.all([
    readCanonicalRevenue(transaction, range),
    readRestatedCogs(transaction, range),
  ]);
  const expenseRows = await transaction.execute<{
    station_id: string;
    station: string;
    business_date: string;
    classification: DailyReportExpense['classification'];
    description: string | null;
    amount: string;
  }>(sql`
    select m.station_id, s.name as station, m.recognition_date::text as business_date,
      m.classification, coalesce(e.description, t.name) as description,
      coalesce(sum(case when m.movement_type = 'REVERSAL' then -m.amount else m.amount end), 0)::text as amount
    from app.expense_recognition_movements m
    join app.stations s on s.tenant_id = m.tenant_id and s.id = m.station_id
    left join app.expenses e on e.tenant_id = m.tenant_id
      and e.id = m.source_id and m.source_type = 'EXPENSE'
    left join app.recurring_cost_recognitions r on r.tenant_id = m.tenant_id
      and r.id = m.source_id and m.source_type = 'RECURRING_COST_RECOGNITION'
    left join app.recurring_cost_periods p on p.tenant_id = r.tenant_id and p.id = r.period_id
    left join app.recurring_cost_templates t on t.tenant_id = p.tenant_id and t.id = p.template_id
    where m.tenant_id = ${filters.tenantId}
      and m.recognition_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('m', filters.stationIds)}
    group by m.station_id, s.name, m.recognition_date, m.classification, e.description, t.name,
      m.source_type, m.source_id
    limit ${limit}
  `);
  const stationNames = new Map(expenseRows.map((row) => [row.station_id, row.station]));
  const salesStationIds = [...new Set(revenue.sales.map((sale) => sale.stationId))];
  const missing = salesStationIds.filter((id) => !stationNames.has(id));
  if (missing.length > 0) {
    const names = await transaction.execute<{ id: string; name: string }>(sql`
      select id, name from app.stations
      where tenant_id = ${filters.tenantId}
        and id in (${sql.join(
          missing.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);
    for (const row of names) stationNames.set(row.id, row.name);
  }
  return buildStationDailyRows({
    stationNames,
    sales: revenue.sales,
    costs: cogs.sales,
    expenses: expenseRows.map((row) => ({
      stationId: row.station_id,
      stationName: row.station,
      businessDate: row.business_date,
      classification: row.classification,
      amount: row.amount,
      description: row.description,
    })),
  });
};
