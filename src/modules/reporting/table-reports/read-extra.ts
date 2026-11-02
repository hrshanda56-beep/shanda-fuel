import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { ManagementReportQuery } from '../contracts';
import { creditSalesToAttendants, type AttendantShiftSale } from '../sales-by-attendant';
import { TABLE_REPORT_ROW_LIMIT } from './definitions';
import type { TableReportReader } from './read';
import { PAYMENT_METHOD_OPTIONS } from './narrowing';

/** `and <column> = <value>` when the person chose a value, otherwise nothing. */
export function equalsClause(column: string, value: string | undefined): SQL {
  return value ? sql`and ${sql.raw(column)} = ${value}` : sql``;
}

type Narrowing = Pick<
  ManagementReportQuery,
  'productId' | 'supplierId' | 'customerId' | 'employeeId' | 'shiftTemplateId' | 'paymentMethod'
>;

/** Only reconciliations that include the chosen attendant and/or payment method. */
export function reconciliationNarrowing(alias: string, filters: Narrowing): SQL {
  const a = sql.raw(alias);
  const employee = filters.employeeId
    ? sql`and exists (select 1 from app.reconciliation_attendants fa
        where fa.tenant_id = ${a}.tenant_id and fa.station_id = ${a}.station_id
          and fa.reconciliation_id = ${a}.id and fa.attendant_id = ${filters.employeeId})`
    : sql``;
  const method = filters.paymentMethod
    ? sql`and exists (select 1 from app.reconciliation_payments fp
        where fp.tenant_id = ${a}.tenant_id and fp.station_id = ${a}.station_id
          and fp.reconciliation_id = ${a}.id and fp.method = ${filters.paymentMethod}
          and fp.amount > 0)`
    : sql``;
  return sql`${employee} ${method}`;
}

const limit = sql.raw(String(TABLE_REPORT_ROW_LIMIT + 1));

function legalEntityClause(column: string, legalEntityIds: readonly string[]): SQL {
  if (legalEntityIds.length === 0) return sql``;
  return sql`and ${sql.raw(column)} in (${sql.join(
    legalEntityIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

export const readSalesByAttendant: TableReportReader = async (transaction, filters) => {
  const stationClause = filters.stationIds.length
    ? sql`and r.station_id in (${sql.join(
        filters.stationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
  const rows = await transaction.execute<{
    station: string;
    attendants: { id: string; name: string }[];
    sales: string | null;
    accounted: string | null;
    litres: string;
  }>(sql`
    select st.name as station,
      coalesce((select json_agg(json_build_object('id', am.id, 'name', coalesce(am.name, 'Unknown')) order by am.name)
         from app.reconciliation_attendants ra
         join app.member_directory(ra.tenant_id) am on am.id = ra.attendant_id
        where ra.tenant_id = r.tenant_id and ra.station_id = r.station_id
          and ra.reconciliation_id = r.id), '[]'::json) as attendants,
      rev.expected_sales::text as sales, rev.accounted_sales::text as accounted,
      coalesce((select sum(mr.litres_sold) from app.reconciliation_meter_readings mr
        where mr.tenant_id = r.tenant_id and mr.station_id = r.station_id
          and mr.reconciliation_id = r.id), 0)::text as litres
    from app.reconciliations r
    join app.stations st on st.tenant_id = r.tenant_id and st.id = r.station_id
    join app.station_business_days bd
      on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
    left join app.shifts sh
      on sh.tenant_id = r.tenant_id and sh.station_id = r.station_id and sh.id = r.shift_id
    join lateral (
      select v.expected_sales, v.accounted_sales
      from app.reconciliation_revisions v
      where v.tenant_id = r.tenant_id and v.station_id = r.station_id and v.reconciliation_id = r.id
      order by v.revision desc limit 1
    ) rev on true
    where r.tenant_id = ${filters.tenantId} and r.state in ('APPROVED', 'POSTED', 'LOCKED')
      and bd.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause}
      ${equalsClause('sh.shift_template_id', filters.shiftTemplateId)}
      ${reconciliationNarrowing('r', filters)}
  `);
  const shifts: AttendantShiftSale[] = rows.map((row) => ({
    stationName: row.station,
    attendants: row.attendants,
    sales: row.sales ?? '0',
    accounted: row.accounted ?? '0',
    litres: row.litres,
  }));
  return creditSalesToAttendants(shifts).map((row) => ({
    station: row.stationName,
    attendant: row.label,
    shifts: String(row.shifts),
    litres: row.litres,
    sales: row.sales,
    accounted: row.accounted,
  }));
};

/** Approved sales by how they were paid, for each station. */
export const readPaymentMethodBreakdown: TableReportReader = async (transaction, filters) => {
  const stationClause = filters.stationIds.length
    ? sql`and r.station_id in (${sql.join(
        filters.stationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
  const rows = await transaction.execute<{
    station: string;
    method: string;
    entries: string;
    amount: string;
  }>(sql`
    select st.name as station, p.method, count(*)::text as entries, sum(p.amount)::text as amount
    from app.reconciliation_payments p
    join app.reconciliations r
      on r.tenant_id = p.tenant_id and r.station_id = p.station_id and r.id = p.reconciliation_id
    join app.stations st on st.tenant_id = r.tenant_id and st.id = r.station_id
    join app.station_business_days bd
      on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
    left join app.shifts sh
      on sh.tenant_id = r.tenant_id and sh.station_id = r.station_id and sh.id = r.shift_id
    where r.tenant_id = ${filters.tenantId} and r.state in ('APPROVED', 'POSTED', 'LOCKED')
      and bd.business_date between ${filters.fromDate} and ${filters.toDate}
      and p.amount > 0
      ${stationClause}
      ${equalsClause('sh.shift_template_id', filters.shiftTemplateId)}
      ${equalsClause('p.method', filters.paymentMethod)}
      ${reconciliationNarrowing('r', { ...filters, paymentMethod: undefined })}
    group by st.name, p.method
    order by st.name, sum(p.amount) desc
    limit ${limit}
  `);
  const labels = new Map(PAYMENT_METHOD_OPTIONS.map((option) => [option.id, option.label]));
  return rows.map((row) => ({
    station: row.station,
    method: labels.get(row.method) ?? row.method,
    entries: row.entries,
    amount: row.amount,
  }));
};
