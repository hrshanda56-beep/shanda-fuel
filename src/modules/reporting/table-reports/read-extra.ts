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

const DOCUMENT_STATES: Record<string, string> = {
  DRAFT: 'Being prepared',
  SUBMITTED: 'Waiting to be posted',
  POSTED: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  REVERSED: 'Reversed',
};

export const readPurchases: TableReportReader = async (
  transaction,
  filters,
  { legalEntityIds },
) => {
  const product = filters.productId
    ? sql`and exists (select 1 from app.supplier_document_lines l
        where l.tenant_id = d.tenant_id and l.supplier_document_id = d.id
          and l.product_id = ${filters.productId})`
    : sql``;
  const rows = await transaction.execute<{
    date: string;
    supplier: string;
    document_type: string;
    reference: string;
    due_date: string | null;
    state: string;
    amount: string;
    paid: string;
    owed: string;
  }>(sql`
    select d.document_date as date, s.legal_name as supplier, d.document_type,
      d.reference_number as reference, d.due_date, d.state, d.amount::text as amount,
      m.paid::text as paid, (d.amount - m.paid)::text as owed
    from app.supplier_documents d
    join app.suppliers s on s.tenant_id = d.tenant_id and s.id = d.supplier_id
    cross join lateral (
      select coalesce(sum(a.amount), 0) as paid from app.supplier_payment_allocations a
      where a.tenant_id = d.tenant_id and a.document_id = d.id and a.state = 'POSTED'
        and not exists (select 1 from app.supplier_payment_allocations x
          where x.tenant_id = a.tenant_id and x.reversal_of_id = a.id and x.state = 'REVERSED')
    ) m
    where d.tenant_id = ${filters.tenantId} and d.state <> 'DRAFT'
      and d.document_date between ${filters.fromDate} and ${filters.toDate}
      ${legalEntityClause('d.legal_entity_id', legalEntityIds)}
      ${equalsClause('d.supplier_id', filters.supplierId)}
      ${product}
    order by d.document_date desc, s.legal_name, d.reference_number, d.id
    limit ${limit}
  `);
  return rows.map((row) => {
    const credit = row.document_type === 'CREDIT_NOTE';
    return {
      date: row.date,
      supplier: row.supplier,
      type: credit ? 'Credit note' : 'Invoice',
      reference: row.reference,
      dueDate: row.due_date,
      status: DOCUMENT_STATES[row.state] ?? row.state,
      amount: row.amount,
      // Payments are only matched to invoices; a credit note owes and pays nothing itself.
      paid: credit ? null : row.paid,
      owed: credit || row.state === 'REVERSED' ? null : row.owed,
    };
  });
};

const PAYMENT_STATES: Record<string, string> = {
  DRAFT: 'Being prepared',
  SUBMITTED: 'Waiting to be posted',
  POSTED: 'Paid',
  REVERSED: 'Reversed',
};

const PAYMENT_METHODS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  MOBILE_MONEY: 'Mobile money',
  ECOCASH: 'EcoCash',
  CHEQUE: 'Cheque',
};

export const readSupplierPayments: TableReportReader = async (
  transaction,
  filters,
  { legalEntityIds },
) => {
  const rows = await transaction.execute<{
    date: string;
    supplier: string;
    reference: string;
    method: string;
    proof: string | null;
    state: string;
    amount: string;
    matched: string;
    unmatched: string;
  }>(sql`
    select p.payment_date as date, s.legal_name as supplier, p.payment_reference as reference,
      p.payment_method as method, p.external_reference as proof, p.state, p.amount::text as amount,
      m.matched::text as matched, (p.amount - m.matched)::text as unmatched
    from app.supplier_payments p
    join app.suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
    cross join lateral (
      select coalesce(sum(a.amount), 0) as matched from app.supplier_payment_allocations a
      where a.tenant_id = p.tenant_id and a.payment_id = p.id and a.state = 'POSTED'
        and not exists (select 1 from app.supplier_payment_allocations x
          where x.tenant_id = a.tenant_id and x.reversal_of_id = a.id and x.state = 'REVERSED')
    ) m
    where p.tenant_id = ${filters.tenantId} and p.state <> 'DRAFT'
      and p.payment_date between ${filters.fromDate} and ${filters.toDate}
      ${legalEntityClause('p.legal_entity_id', legalEntityIds)}
      ${equalsClause('p.supplier_id', filters.supplierId)}
    order by p.payment_date desc, s.legal_name, p.payment_reference, p.id
    limit ${limit}
  `);
  return rows.map((row) => ({
    date: row.date,
    supplier: row.supplier,
    reference: row.reference,
    method: PAYMENT_METHODS[row.method] ?? row.method,
    proof: row.proof,
    status: PAYMENT_STATES[row.state] ?? row.state,
    amount: row.amount,
    matched: row.matched,
    unmatched: row.state === 'REVERSED' ? null : row.unmatched,
  }));
};

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
      coalesce((select json_agg(json_build_object('id', am.id, 'name', coalesce(nullif(u.name, ''), u.email)) order by u.name)
         from app.reconciliation_attendants ra
         join app.memberships am on am.tenant_id = ra.tenant_id and am.id = ra.attendant_id
         join app.users u on u.id = am.identity_id
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
