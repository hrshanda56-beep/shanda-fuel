import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../../platform/db';
import type { ManagementReportQuery } from '../contracts';
import type { TableReportRow } from './definitions';
import { TABLE_REPORT_ROW_LIMIT } from './definitions';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type TableReportReader = (
  transaction: Transaction,
  filters: ManagementReportQuery,
  scope: Readonly<{ legalEntityIds: readonly string[] }>,
) => Promise<TableReportRow[]>;

function stationClause(alias: string, stationIds: readonly string[]): SQL {
  if (stationIds.length === 0) return sql``;
  const ids = sql.join(
    stationIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`and ${sql.raw(`${alias}.station_id`)} in (${ids})`;
}

const limit = sql.raw(String(TABLE_REPORT_ROW_LIMIT + 1));

const utc = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

export const readTankDipHistory: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    measured_at: string;
    station: string;
    tank: string;
    product: string;
    physical_litres: string;
    notes: string | null;
  }>(sql`
    select d.business_date, ${utc('d.measured_at')} as measured_at, s.name as station,
      t.code as tank, p.name as product, d.physical_litres::text as physical_litres, d.notes
    from app.tank_dips d
    join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
    join app.tanks t on t.tenant_id = d.tenant_id and t.station_id = d.station_id and t.id = d.tank_id
    join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
    where d.tenant_id = ${filters.tenantId}
      and d.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('d', filters.stationIds)}
    order by d.business_date desc, d.measured_at desc, s.name, t.code
    limit ${limit}
  `);
  return rows.map((row) => ({
    businessDate: row.business_date,
    measuredAt: row.measured_at,
    station: row.station,
    tank: row.tank,
    product: row.product,
    physicalLitres: row.physical_litres,
    notes: row.notes,
  }));
};

const MOVEMENT_LABELS = sql.raw(`case m.movement_type
  when 'OPENING_BALANCE' then 'Opening stock'
  when 'DELIVERY' then 'Delivery received'
  when 'SALE' then 'Fuel sold'
  when 'APPROVED_ISSUE' then 'Approved fuel issued'
  when 'POSITIVE_ADJUSTMENT' then 'Stock added (adjustment)'
  when 'NEGATIVE_ADJUSTMENT' then 'Stock removed (adjustment)'
  when 'TRANSFER_IN' then 'Transferred in'
  when 'TRANSFER_OUT' then 'Transferred out'
  else m.movement_type end`);

export const readStockMovements: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    effective_at: string;
    station: string;
    tank: string;
    product: string;
    movement_type: string;
    quantity_litres: string;
    reason: string | null;
  }>(sql`
    select m.business_date, ${utc('m.effective_at')} as effective_at, s.name as station,
      t.code as tank, p.name as product, ${MOVEMENT_LABELS} as movement_type,
      m.quantity_litres::text as quantity_litres, m.reason
    from app.inventory_movements m
    join app.stations s on s.tenant_id = m.tenant_id and s.id = m.station_id
    join app.tanks t on t.tenant_id = m.tenant_id and t.station_id = m.station_id and t.id = m.tank_id
    join app.products p on p.tenant_id = m.tenant_id and p.id = m.product_id
    where m.tenant_id = ${filters.tenantId}
      and m.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('m', filters.stationIds)}
    order by m.business_date desc, m.effective_at desc, s.name, t.code, m.id
    limit ${limit}
  `);
  return rows.map((row) => ({
    businessDate: row.business_date,
    effectiveAt: row.effective_at,
    station: row.station,
    tank: row.tank,
    product: row.product,
    movementType: row.movement_type,
    quantityLitres: row.quantity_litres,
    reason: row.reason,
  }));
};

export const readDeliveryVariance: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    station: string;
    product: string;
    delivery_note: string;
    supplier: string | null;
    note_litres: string;
    actual_litres: string;
    shortage_excess: string;
  }>(sql`
    select f.business_date, s.name as station, p.name as product,
      f.delivery_note_number as delivery_note, sup.legal_name as supplier,
      f.note_quantity_litres::text as note_litres, f.actual_quantity_litres::text as actual_litres,
      f.shortage_excess_litres::text as shortage_excess
    from app.fuel_deliveries f
    join app.stations s on s.tenant_id = f.tenant_id and s.id = f.station_id
    join app.products p on p.tenant_id = f.tenant_id and p.id = f.product_id
    left join app.suppliers sup on sup.tenant_id = f.tenant_id and sup.id = f.supplier_id
    where f.tenant_id = ${filters.tenantId} and f.status = 'CONFIRMED'
      and f.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('f', filters.stationIds)}
    order by f.business_date desc, s.name, f.delivery_note_number
    limit ${limit}
  `);
  return rows.map((row) => ({
    businessDate: row.business_date,
    station: row.station,
    product: row.product,
    deliveryNote: row.delivery_note,
    supplier: row.supplier,
    noteLitres: row.note_litres,
    actualLitres: row.actual_litres,
    shortageExcessLitres: row.shortage_excess,
  }));
};

export const readExpensesDetail: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    station: string;
    category: string;
    classification: string;
    description: string;
    payee: string | null;
    reference: string | null;
    amount: string;
  }>(sql`
    select m.recognition_date as business_date, s.name as station, c.name as category,
      m.classification,
      coalesce(e.description, t.name, 'Recognised expense') as description,
      e.payee, e.reference,
      coalesce(sum(case when m.movement_type = 'REVERSAL' then -m.amount else m.amount end), 0)::text as amount
    from app.expense_recognition_movements m
    join app.stations s on s.tenant_id = m.tenant_id and s.id = m.station_id
    join app.expense_categories c on c.tenant_id = m.tenant_id and c.id = m.category_id
    left join app.expenses e on e.tenant_id = m.tenant_id
      and e.id = m.source_id and m.source_type = 'EXPENSE'
    left join app.recurring_cost_recognitions r on r.tenant_id = m.tenant_id
      and r.id = m.source_id and m.source_type = 'RECURRING_COST_RECOGNITION'
    left join app.recurring_cost_periods p on p.tenant_id = r.tenant_id and p.id = r.period_id
    left join app.recurring_cost_templates t on t.tenant_id = p.tenant_id and t.id = p.template_id
    where m.tenant_id = ${filters.tenantId}
      and m.recognition_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('m', filters.stationIds)}
    group by m.recognition_date, s.name, c.name, m.classification, e.description, t.name,
      e.payee, e.reference, m.source_type, m.source_id
    order by m.recognition_date desc, s.name, c.name, m.source_id
    limit ${limit}
  `);
  const kinds: Record<string, string> = {
    OPERATING: 'Running cost',
    FIXED_COST: 'Fixed cost',
    DIRECT_INVENTORY_COST: 'Cost of fuel stock',
  };
  return rows.map((row) => ({
    businessDate: row.business_date,
    station: row.station,
    category: row.category,
    kind: kinds[row.classification] ?? row.classification,
    description: row.description,
    payee: row.payee,
    reference: row.reference,
    amount: row.amount,
  }));
};

export const readSupplierStatement: TableReportReader = async (
  transaction,
  filters,
  { legalEntityIds },
) => {
  const entities =
    legalEntityIds.length > 0
      ? sql`and m.legal_entity_id in (${sql.join(
          legalEntityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const rows = await transaction.execute<{
    date: string;
    supplier: string;
    what: string;
    amount: string;
    balance: string;
  }>(sql`
    select * from (
      select m.effective_date as date, s.legal_name as supplier,
        case m.movement_type when 'INVOICE' then 'Invoice' when 'CREDIT_NOTE' then 'Credit note'
          when 'PAYMENT' then 'Payment' when 'PAYMENT_REVERSAL' then 'Payment reversed'
          else m.movement_type end as what,
        (case when m.movement_type in ('INVOICE', 'PAYMENT_REVERSAL') then m.amount
              when m.movement_type in ('CREDIT_NOTE', 'PAYMENT') then -m.amount
              else 0 end)::text as amount,
        (sum(case when m.movement_type in ('INVOICE', 'PAYMENT_REVERSAL') then m.amount
                  when m.movement_type in ('CREDIT_NOTE', 'PAYMENT') then -m.amount
                  else 0 end)
          over (partition by m.supplier_id order by m.effective_date, m.posted_at, m.id))::text as balance,
        m.supplier_id, m.posted_at, m.id
      from app.supplier_account_movements m
      join app.suppliers s on s.tenant_id = m.tenant_id and s.id = m.supplier_id
      where m.tenant_id = ${filters.tenantId} and m.effective_date <= ${filters.toDate}
        ${entities}
    ) statement
    where date >= ${filters.fromDate}
    order by supplier, date, posted_at, id
    limit ${limit}
  `);
  return rows.map((row) => ({
    date: row.date,
    supplier: row.supplier,
    what: row.what,
    amount: row.amount,
    balance: row.balance,
  }));
};

export const readCustomerStatement: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    date: string;
    customer: string;
    account: string;
    what: string;
    amount: string;
    balance: string;
  }>(sql`
    select * from (
      select l.business_date as date, c.display_name as customer,
        case l.account_type when 'CREDIT' then 'Credit account' else 'Prepaid value' end as account,
        case l.entry_type when 'CREDIT_FUEL_CHARGE' then 'Fuel on account'
          when 'CUSTOMER_PAYMENT' then 'Payment received' when 'PREPAID_TOPUP' then 'Prepaid top-up'
          when 'PREPAID_FUEL_USAGE' then 'Prepaid fuel used' when 'ADJUSTMENT' then 'Adjustment'
          when 'REVERSAL' then 'Reversal' else l.entry_type end as what,
        (case when l.direction = 'INCREASE' then l.amount else -l.amount end)::text as amount,
        (sum(case when l.direction = 'INCREASE' then l.amount else -l.amount end)
          over (partition by l.customer_id, l.account_type
                order by l.business_date, l.occurred_at, l.id))::text as balance,
        l.occurred_at, l.id
      from app.customer_ledger_entries l
      join app.customers c on c.tenant_id = l.tenant_id and c.id = l.customer_id
      where l.tenant_id = ${filters.tenantId} and l.business_date <= ${filters.toDate}
        and l.account_type in ('CREDIT', 'PREPAID_VALUE')
    ) statement
    where date >= ${filters.fromDate}
    order by customer, account, date, occurred_at, id
    limit ${limit}
  `);
  return rows.map((row) => ({
    date: row.date,
    customer: row.customer,
    account: row.account,
    what: row.what,
    amount: row.amount,
    balance: row.balance,
  }));
};

export const readCashCustody: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    date: string;
    station: string;
    from_name: string;
    to_name: string;
    handed_by: string | null;
    received_by: string | null;
    expected: string;
    counted: string | null;
    difference: string | null;
    state: string;
    note: string | null;
  }>(sql`
    select to_char((coalesce(h.submitted_at, h.created_at) at time zone st.timezone)::date, 'YYYY-MM-DD') as date,
      st.name as station, fl.name as from_name, tl.name as to_name,
      du.name as handed_by, ru.name as received_by,
      h.expected_amount::text as expected, h.counted_amount::text as counted,
      h.variance::text as difference, h.state,
      coalesce(h.resolution_note, h.dispute_reason) as note
    from app.cash_handovers h
    join app.stations st on st.tenant_id = h.tenant_id and st.id = h.station_id
    join app.cash_locations fl on fl.tenant_id = h.tenant_id and fl.id = h.from_location_id
    join app.cash_locations tl on tl.tenant_id = h.tenant_id and tl.id = h.to_location_id
    left join app.memberships dm on dm.tenant_id = h.tenant_id and dm.id = h.delivered_by
    left join app.users du on du.id = dm.identity_id
    left join app.memberships rm on rm.tenant_id = h.tenant_id
      and rm.id = coalesce(h.resolved_by, h.received_by)
    left join app.users ru on ru.id = rm.identity_id
    where h.tenant_id = ${filters.tenantId} and h.state <> 'DRAFT'
      and (coalesce(h.submitted_at, h.created_at) at time zone st.timezone)::date between ${filters.fromDate}::date and ${filters.toDate}::date
      ${stationClause('h', filters.stationIds)}
    order by coalesce(h.submitted_at, h.created_at) desc, h.id desc
    limit ${limit}
  `);
  const statuses: Record<string, string> = {
    SUBMITTED: 'Waiting to be accepted',
    ACCEPTED: 'Accepted',
    DISPUTED: 'Does not add up',
    RESOLVED: 'Settled',
    CANCELLED: 'Withdrawn',
  };
  return rows.map((row) => ({
    date: row.date,
    station: row.station,
    from: row.from_name,
    to: row.to_name,
    handedBy: row.handed_by,
    receivedBy: row.received_by,
    expected: row.expected,
    counted: row.counted,
    difference: row.difference,
    status: statuses[row.state] ?? row.state,
    note: row.note,
  }));
};

export const readBankDeposits: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    date: string;
    station: string;
    bank_account: string;
    deposit_reference: string;
    amount: string;
    confirmed: string | null;
    difference: string | null;
    state: string;
  }>(sql`
    select to_char((d.deposited_at at time zone st.timezone)::date, 'YYYY-MM-DD') as date,
      st.name as station, b.name as bank_account, d.deposit_reference,
      d.amount::text as amount, d.confirmed_amount::text as confirmed,
      d.confirmation_variance::text as difference, d.state
    from app.bank_deposits d
    join app.stations st on st.tenant_id = d.tenant_id and st.id = d.station_id
    join app.bank_accounts b on b.tenant_id = d.tenant_id and b.id = d.bank_account_id
    where d.tenant_id = ${filters.tenantId}
      and (d.deposited_at at time zone st.timezone)::date between ${filters.fromDate}::date and ${filters.toDate}::date
      ${stationClause('d', filters.stationIds)}
    order by d.deposited_at desc, d.id desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    date: row.date,
    station: row.station,
    bankAccount: row.bank_account,
    depositReference: row.deposit_reference,
    amount: row.amount,
    confirmed: row.confirmed,
    difference: row.difference,
    status: row.state.charAt(0) + row.state.slice(1).toLowerCase().replaceAll('_', ' '),
  }));
};

export const TABLE_REPORT_READERS: Readonly<Record<string, TableReportReader>> = {
  'tank-dip-history': readTankDipHistory,
  'stock-movements': readStockMovements,
  'delivery-variance': readDeliveryVariance,
  'expenses-detail': readExpensesDetail,
  'supplier-statement': readSupplierStatement,
  'customer-statement': readCustomerStatement,
  'cash-custody': readCashCustody,
  'bank-deposits': readBankDeposits,
};
