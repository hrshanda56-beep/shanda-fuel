import { resolveTenantReadAuthority } from '../context/read-authority';
import 'server-only';

import { sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import { withTenantTransaction } from '../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { DEFAULT_ROLE_PERMISSIONS, authorize } from '../../platform/security/permissions';
import { assertStepUp } from '../../platform/security';
import { AppError } from '../../platform/errors';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import { readOwnerPosition } from './owner-position';
import { fixedCostAmountForDate, fixedCostIsActiveOnDate } from './fixed-cost-allocation';
import { buildProfitabilityReport, readCanonicalRevenue, readRestatedCogs } from '../profitability';
import {
  averageRealizedPrice,
  customerScopeAvailability,
  deriveCashPosition,
  exact,
  formatLitres,
  formatMoney,
  subtractExact,
  sumObservedExact,
  sumExact,
  uniqueIds,
} from './domain';
import {
  managementReportQuerySchema,
  type CustomerCreditActivityRow,
  type CustomerExposure,
  type DailyOperationsRow,
  type ManagementReport,
  type ManagementReportQuery,
  type ReportExpenseClassification,
  type ReportDateBasis,
  type SalesPaymentRow,
} from './contracts';

type ReportingTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type AggregateRow = { value: string | null };
type IdAggregateRow = AggregateRow & { ids: string[] | null };

const FINAL_RECONCILIATION_STATES = sql`('APPROVED', 'POSTED', 'LOCKED')`;

function dateInHarare(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(now);
}

export function parseManagementReportQuery(input: unknown): ManagementReportQuery {
  const parsed = managementReportQuerySchema.parse(input);
  const today = dateInHarare();
  return {
    ...parsed,
    fromDate: parsed.fromDate ?? today,
    toDate: parsed.toDate ?? parsed.fromDate ?? today,
  };
}

function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

function stationClause(alias: string, stationIds: readonly string[]) {
  return stationIds.length > 0
    ? sql`and ${sql.raw(`${alias}.station_id`)} in (${idList(stationIds)})`
    : sql``;
}

function legalEntityClause(alias: string, legalEntityIds: readonly string[]) {
  return legalEntityIds.length > 0
    ? sql`and ${sql.raw(`${alias}.legal_entity_id`)} in (${idList(legalEntityIds)})`
    : sql``;
}

function datesBetween(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function approvedReconciliations(filters: ManagementReportQuery) {
  return sql`
    select distinct on (r.id)
      r.id as reconciliation_id,
      r.station_id,
      bd.business_date,
      rev.id as revision_id,
      rev.expected_sales,
      rev.accounted_sales,
      rev.variance
    from app.reconciliations r
    join app.station_business_days bd
      on bd.tenant_id = r.tenant_id
     and bd.station_id = r.station_id
     and bd.id = r.business_day_id
    join app.reconciliation_revisions rev
      on rev.tenant_id = r.tenant_id
     and rev.station_id = r.station_id
     and rev.reconciliation_id = r.id
    where r.tenant_id = ${filters.tenantId}
      and rev.state in ${FINAL_RECONCILIATION_STATES}
      and bd.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('r', filters.stationIds)}
    order by r.id, rev.revision desc
  `;
}

async function selectedStations(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<{ id: string; legalEntityId: string }[]> {
  if (filters.stationIds.length === 0) return [];
  const rows = await transaction.execute<{ id: string; legal_entity_id: string }>(sql`
    select id, legal_entity_id
    from app.stations
    where tenant_id = ${filters.tenantId}
      and id in (${idList(filters.stationIds)})
      and status = 'ACTIVE'
  `);
  if (rows.length !== filters.stationIds.length) {
    throw new AppError('NOT_FOUND', 'A requested reporting station was not found');
  }
  return rows.map((row) => ({ id: row.id, legalEntityId: row.legal_entity_id }));
}

/**
 * Operational figures (sales, daily operations, the operational table reports) need `report.view`;
 * profit, financial position and the finance reports need `report.finance.view`.
 */
export type ReportPermission = 'report.view' | 'report.finance.view';

/** Every requested station must be authorised; one failure rejects the whole request. */
function authorizeStations(
  actor: Parameters<typeof authorize>[0]['actor'],
  filters: ManagementReportQuery,
  stations: readonly { id: string; legalEntityId: string }[],
  permissionCode: ReportPermission = 'report.finance.view',
) {
  if (stations.length === 0) {
    authorize({
      actor,
      permissionCode,
      requestedScope: { tenantId: filters.tenantId, scopeType: 'TENANT' as const },
    });
    return;
  }
  for (const station of stations) {
    authorize({
      actor,
      permissionCode,
      requestedScope: {
        tenantId: filters.tenantId,
        scopeType: 'STATION' as const,
        legalEntityId: station.legalEntityId,
        stationId: station.id,
      },
    });
  }
}

async function listStations(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<ManagementReport['stations']> {
  const rows = await transaction.execute<{ id: string; code: string; name: string }>(sql`
    select id, code, name
    from app.stations
    where tenant_id = ${filters.tenantId}
      and status = 'ACTIVE'
      ${filters.stationIds.length > 0 ? sql`and id in (${idList(filters.stationIds)})` : sql``}
    order by code, id
  `);
  return rows.map((row) => ({ stationId: row.id, code: row.code, name: row.name }));
}

async function readSales(transaction: ReportingTransaction, filters: ManagementReportQuery) {
  const base = approvedReconciliations(filters);
  const [totals, payments, rows] = await Promise.all([
    transaction.execute<{
      litres: string;
      sales_value: string;
      reconciliation_count: number;
      variance: string;
      ids: string[] | null;
    }>(sql`
      with approved as (${base})
      select
        coalesce((select sum(m.litres_sold) from approved a join app.reconciliation_meter_readings m
          on m.tenant_id = ${filters.tenantId} and m.station_id = a.station_id and m.reconciliation_id = a.reconciliation_id), 0)::text as litres,
        coalesce(sum(accounted_sales), 0)::text as sales_value,
        count(*)::int as reconciliation_count,
        coalesce(sum(variance), 0)::text as variance,
        coalesce(array_agg(reconciliation_id order by reconciliation_id), ARRAY[]::uuid[]) as ids
      from approved
    `),
    transaction.execute<{ method: string; amount: string; ids: string[] | null }>(sql`
      with approved as (${base})
      select p.method, coalesce(sum(p.amount), 0)::text as amount,
        coalesce(array_agg(p.id order by p.id), ARRAY[]::uuid[]) as ids
      from approved a
      join app.reconciliation_payments p
        on p.tenant_id = ${filters.tenantId}
       and p.station_id = a.station_id
       and p.reconciliation_id = a.reconciliation_id
      group by p.method
      order by p.method
    `),
    transaction.execute<{
      business_date: string;
      station_id: string;
      station_code: string;
      product_id: string;
      product_code: string;
      product_name: string;
      litres: string;
      sales_value: string;
      variance: string;
      reconciliation_ids: string[] | null;
    }>(sql`
      with approved as (${base})
      select bd.business_date, a.station_id, s.code as station_code,
        m.product_id, p.code as product_code, p.name as product_name,
        coalesce(sum(m.litres_sold), 0)::text as litres,
        coalesce(sum(m.sales_value), 0)::text as sales_value,
        coalesce(max(a.variance), 0)::text as variance,
        coalesce(array_agg(distinct a.reconciliation_id), ARRAY[]::uuid[]) as reconciliation_ids
      from approved a
      join app.station_business_days bd
        on bd.tenant_id = ${filters.tenantId} and bd.station_id = a.station_id
       and bd.business_date = a.business_date
      join app.reconciliation_meter_readings m
        on m.tenant_id = ${filters.tenantId} and m.station_id = a.station_id
       and m.reconciliation_id = a.reconciliation_id
      join app.products p on p.tenant_id = m.tenant_id and p.id = m.product_id
      join app.stations s on s.tenant_id = m.tenant_id and s.id = m.station_id
      group by bd.business_date, a.station_id, s.code, m.product_id, p.code, p.name
      order by bd.business_date, s.code, p.code
    `),
  ]);
  const total = totals[0] ?? {
    litres: '0',
    sales_value: '0',
    reconciliation_count: 0,
    variance: '0',
    ids: [],
  };
  return {
    litresSold: formatLitres(total.litres),
    salesValue: formatMoney(total.sales_value),
    approvedReconciliationCount: total.reconciliation_count,
    salesVariance: formatMoney(total.variance),
    reconciliationIds: uniqueIds(total.ids ?? []),
    payments: payments.map((row): SalesPaymentRow => ({
      method: row.method,
      amount: formatMoney(row.amount),
      evidenceIds: uniqueIds(row.ids ?? []),
    })),
    rows: rows.map((row) => ({
      businessDate: row.business_date,
      stationId: row.station_id,
      stationCode: row.station_code,
      productId: row.product_id,
      productCode: row.product_code,
      productName: row.product_name,
      litres: formatLitres(row.litres),
      salesValue: formatMoney(row.sales_value),
      averageRealizedPrice: averageRealizedPrice(row.litres, row.sales_value),
      variance: formatMoney(row.variance),
      reconciliationIds: uniqueIds(row.reconciliation_ids ?? []),
    })),
  };
}

async function readCash(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<ManagementReport['cash']> {
  const base = approvedReconciliations(filters);
  const [evidence, collections] = await Promise.all([
    transaction.execute<{ evidence: string; variance: string }>(sql`
      with approved as (${base})
      select
        coalesce((select sum(p.amount) from approved a join app.reconciliation_payments p
          on p.tenant_id = ${filters.tenantId} and p.station_id = a.station_id
         and p.reconciliation_id = a.reconciliation_id and p.method = 'CASH'), 0)::text as evidence,
        coalesce((select sum(c.cash_variance) from approved a join app.reconciliation_cash_declarations c
          on c.tenant_id = ${filters.tenantId} and c.station_id = a.station_id
         and c.reconciliation_id = a.reconciliation_id), 0)::text as variance
    `),
    transaction.execute<{
      collected: string;
      banked: string;
      collection_ids: string[] | null;
      deposit_ids: string[] | null;
    }>(sql`
      with period_collections as (
        select c.id, c.amount
        from app.cash_collections c
        where c.tenant_id = ${filters.tenantId}
          and c.state <> 'REVERSED'
          and c.business_date between ${filters.fromDate} and ${filters.toDate}
          ${stationClause('c', filters.stationIds)}
      ), period_deposits as (
        select d.id, d.tenant_id, d.station_id
        from app.bank_deposits d
        where d.tenant_id = ${filters.tenantId}
          and d.state = 'CONFIRMED'
          and d.deposited_at >= (${filters.fromDate}::date at time zone 'UTC')
          and d.deposited_at < ((${filters.toDate}::date + interval '1 day') at time zone 'UTC')
          ${stationClause('d', filters.stationIds)}
      )
      select
        (select coalesce(sum(amount), 0)::text from period_collections) as collected,
        (select coalesce(sum(a.amount), 0)::text
         from period_deposits d
         join app.bank_deposit_allocations a
           on a.tenant_id = d.tenant_id and a.station_id = d.station_id and a.deposit_id = d.id) as banked,
        (select coalesce(array_agg(id order by id), ARRAY[]::uuid[]) from period_collections) as collection_ids,
        (select coalesce(array_agg(id order by id), ARRAY[]::uuid[]) from period_deposits) as deposit_ids
    `),
  ]);
  const evidenceRow = evidence[0] ?? { evidence: '0', variance: '0' };
  const collectionRow = collections[0] ?? {
    collected: '0',
    banked: '0',
    collection_ids: [],
    deposit_ids: [],
  };
  return {
    ...deriveCashPosition({
      evidence: evidenceRow.evidence,
      collected: collectionRow.collected,
      banked: collectionRow.banked,
      variance: evidenceRow.variance,
    }),
    collectionIds: uniqueIds(collectionRow.collection_ids ?? []),
    depositIds: uniqueIds(collectionRow.deposit_ids ?? []),
  };
}

async function readProviders(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<ManagementReport['providers']> {
  const base = approvedReconciliations(filters);
  const [evidence, settlements, unmatched] = await Promise.all([
    transaction.execute<AggregateRow>(sql`
      with approved as (${base})
      select coalesce(sum(p.amount), 0)::text as value
      from approved a join app.reconciliation_payments p
        on p.tenant_id = ${filters.tenantId} and p.station_id = a.station_id
       and p.reconciliation_id = a.reconciliation_id
       and p.method in ('POS', 'ECOCASH')
    `),
    transaction.execute<{
      id: string;
      provider_id: string;
      provider_name: string;
      station_id: string;
      transaction_date: string;
      settlement_date: string;
      settlement_reference: string;
      gross: string;
      allocated: string;
      fees: string;
    }>(sql`
      with allocation_totals as (
        select settlement_id, coalesce(sum(a.amount) filter (where a.state = 'POSTED' and not exists (
          select 1 from app.provider_settlement_allocations reversal
          where reversal.tenant_id = a.tenant_id and reversal.reversal_of_id = a.id and reversal.state = 'REVERSED'
        )), 0)::text as allocated
        from app.provider_settlement_allocations a
        where a.tenant_id = ${filters.tenantId}
        group by settlement_id
      )
      select s.id, pp.id as provider_id, pp.name as provider_name, s.station_id,
        s.transaction_date, s.settlement_date, s.settlement_reference,
        s.gross_amount::text as gross, coalesce(a.allocated, '0') as allocated,
        (coalesce(s.provider_fee_amount, 0) + coalesce(s.provider_deduction_amount, 0))::text as fees
      from app.provider_settlements s
      join app.provider_accounts pa on pa.tenant_id = s.tenant_id and pa.id = s.provider_account_id
      join app.payment_providers pp on pp.tenant_id = pa.tenant_id and pp.id = pa.provider_id
      left join allocation_totals a on a.settlement_id = s.id
      where s.tenant_id = ${filters.tenantId}
        and s.settlement_date between ${filters.fromDate} and ${filters.toDate}
        ${stationClause('s', filters.stationIds)}
      order by s.settlement_date, pp.name, s.settlement_reference
    `),
    transaction.execute<AggregateRow>(sql`
      with approved as (${base}), allocations as (
        select reconciliation_payment_id, coalesce(sum(a.amount) filter (where a.state = 'POSTED' and not exists (
          select 1 from app.provider_settlement_allocations reversal
          where reversal.tenant_id = a.tenant_id and reversal.reversal_of_id = a.id and reversal.state = 'REVERSED'
        )), 0)::text as allocated
        from app.provider_settlement_allocations a
        where a.tenant_id = ${filters.tenantId}
        group by reconciliation_payment_id
      )
      select coalesce(sum(p.amount - coalesce(a.allocated::numeric, 0)), 0)::text as value
      from approved r
      join app.reconciliation_payments p on p.tenant_id = ${filters.tenantId}
       and p.station_id = r.station_id and p.reconciliation_id = r.reconciliation_id
       and p.method in ('POS', 'ECOCASH')
      left join allocations a on a.reconciliation_payment_id = p.id
    `),
  ]);
  const rows = settlements.map((row) => ({
    settlementId: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    stationId: row.station_id,
    transactionDate: row.transaction_date,
    settlementDate: row.settlement_date,
    settlementReference: row.settlement_reference,
    grossAmount: formatMoney(row.gross),
    allocatedAmount: formatMoney(row.allocated),
    unallocatedAmount: formatMoney(subtractExact(row.gross, row.allocated)),
    feesAndDeductions: formatMoney(row.fees),
    variance: formatMoney(subtractExact(row.gross, row.allocated)),
  }));
  return {
    paymentEvidence: formatMoney(evidence[0]?.value),
    settlementGross: formatMoney(sumExact(rows.map((row) => row.grossAmount))),
    allocatedAmount: formatMoney(sumExact(rows.map((row) => row.allocatedAmount))),
    unallocatedProviderAmount: formatMoney(sumExact(rows.map((row) => row.unallocatedAmount))),
    unmatchedEvidenceAmount: formatMoney(unmatched[0]?.value),
    settlementVariance: formatMoney(sumExact(rows.map((row) => row.variance))),
    feesAndDeductions: formatMoney(sumExact(rows.map((row) => row.feesAndDeductions))),
    rows,
  };
}

async function readSuppliers(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
  legalEntityIds: readonly string[],
): Promise<ManagementReport['suppliers']> {
  const rows = await transaction.execute<{
    supplier_id: string;
    code: string;
    legal_name: string;
    invoice_value: string;
    credit_note_value: string;
    payments: string;
    outstanding: string;
  }>(sql`
    select s.id as supplier_id, s.code, s.legal_name,
      coalesce(sum(m.amount) filter (where m.movement_type = 'INVOICE'), 0)::text as invoice_value,
      coalesce(sum(m.amount) filter (where m.movement_type = 'CREDIT_NOTE'), 0)::text as credit_note_value,
      coalesce(sum(case when m.movement_type = 'PAYMENT' then m.amount when m.movement_type = 'PAYMENT_REVERSAL' then -m.amount else 0 end), 0)::text as payments,
      coalesce(sum(case when m.movement_type in ('INVOICE', 'PAYMENT_REVERSAL') then m.amount
                        when m.movement_type in ('CREDIT_NOTE', 'PAYMENT') then -m.amount
                        else 0 end), 0)::text as outstanding
    from app.suppliers s
    left join app.supplier_account_movements m
      on m.tenant_id = s.tenant_id and m.supplier_id = s.id
     and m.effective_date <= ${filters.toDate}
     ${legalEntityClause('m', legalEntityIds)}
    where s.tenant_id = ${filters.tenantId}
    group by s.id, s.code, s.legal_name
    order by s.code, s.id
  `);
  const mapped = rows.map((row) => ({
    supplierId: row.supplier_id,
    supplierCode: row.code,
    supplierName: row.legal_name,
    invoiceValue: formatMoney(row.invoice_value),
    creditNoteValue: formatMoney(row.credit_note_value),
    payments: formatMoney(row.payments),
    outstandingBalance: formatMoney(row.outstanding),
  }));
  return {
    invoiceValue: formatMoney(sumExact(mapped.map((row) => row.invoiceValue))),
    creditNoteValue: formatMoney(sumExact(mapped.map((row) => row.creditNoteValue))),
    payments: formatMoney(sumExact(mapped.map((row) => row.payments))),
    outstandingBalance: formatMoney(sumExact(mapped.map((row) => row.outstandingBalance))),
    rows: mapped,
  };
}

async function readCustomerActivity(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<CustomerCreditActivityRow[]> {
  const rows = await transaction.execute<{
    station_id: string;
    account_type: string;
    drawn_amount: string;
    drawn_litres: string;
    authorization_count: string;
  }>(sql`
    select station_id, account_type,
      coalesce(sum(used_amount), 0)::text as drawn_amount,
      coalesce(sum(used_litres), 0)::text as drawn_litres,
      count(*)::text as authorization_count
    from app.customer_fuel_authorizations
    where tenant_id = ${filters.tenantId}
      and used_amount > 0
      and requested_at >= ${filters.fromDate}::date
      and requested_at < (${filters.toDate}::date + interval '1 day')
      ${stationClause('customer_fuel_authorizations', filters.stationIds)}
    group by station_id, account_type
    order by station_id, account_type
  `);
  return rows.map((row) => ({
    stationId: row.station_id,
    accountType: row.account_type,
    drawnAmount: formatMoney(row.drawn_amount),
    drawnLitres: formatLitres(row.drawn_litres),
    authorizationCount: Number(row.authorization_count),
  }));
}

async function readCustomers(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<CustomerExposure> {
  const activity = await readCustomerActivity(transaction, filters);
  // A8 ledger balances are tenant-owned and intentionally do not carry a
  // station dimension (ADR-017). Do not expose a tenant-wide balance to a
  // station report; what was drawn at each station is shown as `activity`.
  if (filters.stationIds.length > 0) {
    return {
      activity,
      availability: customerScopeAvailability(filters.stationIds),
      receivableBalance: null,
      prepaidValueBalance: null,
      reservedAmount: null,
      reservedLitres: null,
      rows: [],
    };
  }
  const rows = await transaction.execute<{
    customer_id: string;
    account_reference: string;
    display_name: string;
    receivable: string;
    prepaid_value: string;
    reserved_amount: string;
    reserved_litres: string;
  }>(sql`
    with balances as (
      select customer_id,
        coalesce(sum(amount) filter (where account_type = 'CREDIT' and direction = 'INCREASE'), 0)
          - coalesce(sum(amount) filter (where account_type = 'CREDIT' and direction = 'DECREASE'), 0) as receivable,
        coalesce(sum(amount) filter (where account_type = 'PREPAID_VALUE' and direction = 'INCREASE'), 0)
          - coalesce(sum(amount) filter (where account_type = 'PREPAID_VALUE' and direction = 'DECREASE'), 0) as prepaid_value
      from app.customer_ledger_entries
      where tenant_id = ${filters.tenantId} and business_date <= ${filters.toDate}
      group by customer_id
    ), reservations as (
      select customer_id,
        coalesce(sum(remaining_amount), 0) as reserved_amount,
        coalesce(sum(remaining_litres), 0) as reserved_litres
      from app.customer_fuel_authorizations
      where tenant_id = ${filters.tenantId}
        and state in ('AUTHORIZED', 'PARTIALLY_USED')
        and requested_at < (${filters.toDate}::date + interval '1 day')
        ${stationClause('customer_fuel_authorizations', filters.stationIds)}
      group by customer_id
    )
    select c.id as customer_id, c.account_reference, c.display_name,
      coalesce(b.receivable, 0)::text as receivable,
      coalesce(b.prepaid_value, 0)::text as prepaid_value,
      coalesce(r.reserved_amount, 0)::text as reserved_amount,
      coalesce(r.reserved_litres, 0)::text as reserved_litres
    from app.customers c
    left join balances b on b.customer_id = c.id
    left join reservations r on r.customer_id = c.id
    where c.tenant_id = ${filters.tenantId}
    order by c.account_reference, c.id
  `);
  const mapped = rows.map((row) => ({
    customerId: row.customer_id,
    accountReference: row.account_reference,
    displayName: row.display_name,
    receivableBalance: formatMoney(row.receivable),
    prepaidValueBalance: formatMoney(row.prepaid_value),
    reservedAmount: formatMoney(row.reserved_amount),
    reservedLitres: formatLitres(row.reserved_litres),
  }));
  return {
    activity,
    availability: customerScopeAvailability(),
    receivableBalance: formatMoney(sumExact(mapped.map((row) => row.receivableBalance))),
    prepaidValueBalance: formatMoney(sumExact(mapped.map((row) => row.prepaidValueBalance))),
    reservedAmount: formatMoney(sumExact(mapped.map((row) => row.reservedAmount))),
    reservedLitres: formatLitres(sumExact(mapped.map((row) => row.reservedLitres))),
    rows: mapped,
  };
}

async function readInventory(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<ManagementReport['inventory']> {
  const rows = await transaction.execute<{
    station_id: string;
    tank_id: string;
    tank_code: string;
    product_id: string;
    product_code: string;
    product_name: string;
    capacity: string;
    reorder_level: string | null;
    acceptable_variance: string | null;
    variance_red: string | null;
    expected: string;
    physical: string | null;
    variance: string | null;
    delivery_litres: string;
    delivery_value: string;
    movement_ids: string[] | null;
    delivery_ids: string[] | null;
  }>(sql`
    with movement_totals as (
      select station_id, tank_id, product_id, coalesce(sum(quantity_litres), 0)::text as expected,
        coalesce(array_agg(id order by effective_at, id), ARRAY[]::uuid[]) as movement_ids
      from app.inventory_movements
      where tenant_id = ${filters.tenantId} and business_date <= ${filters.toDate}
      group by station_id, tank_id, product_id
    ), latest_dips as (
      select distinct on (station_id, tank_id) station_id, tank_id, physical_litres::text as physical
      from app.tank_dips
      where tenant_id = ${filters.tenantId}
        and measured_at < (${filters.toDate}::date + interval '1 day')
      order by station_id, tank_id, measured_at desc, id desc
    ), deliveries as (
      select station_id, product_id, coalesce(sum(actual_quantity_litres), 0)::text as delivery_litres,
        coalesce(sum(total_landed_cost), 0)::text as delivery_value,
        coalesce(array_agg(id order by delivered_at, id), ARRAY[]::uuid[]) as delivery_ids
      from app.fuel_deliveries
      where tenant_id = ${filters.tenantId} and status = 'CONFIRMED'
        and business_date between ${filters.fromDate} and ${filters.toDate}
      group by station_id, product_id
    )
    select t.station_id, t.id as tank_id, t.code as tank_code, t.product_id,
      p.code as product_code, p.name as product_name,
      t.capacity_litres::text as capacity, t.reorder_level_litres::text as reorder_level,
      t.acceptable_variance_litres::text as acceptable_variance,
      t.variance_red_litres::text as variance_red,
      coalesce(m.expected, '0') as expected, d.physical,
      case when d.physical is null then null else (d.physical::numeric - coalesce(m.expected, '0')::numeric)::text end as variance,
      coalesce(del.delivery_litres, '0') as delivery_litres,
      coalesce(del.delivery_value, '0') as delivery_value,
      coalesce(m.movement_ids, ARRAY[]::uuid[]) as movement_ids,
      coalesce(del.delivery_ids, ARRAY[]::uuid[]) as delivery_ids
    from app.tanks t
    join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
    left join movement_totals m on m.station_id = t.station_id and m.tank_id = t.id and m.product_id = t.product_id
    left join latest_dips d on d.station_id = t.station_id and d.tank_id = t.id
    left join deliveries del on del.station_id = t.station_id and del.product_id = t.product_id
    where t.tenant_id = ${filters.tenantId} and t.status <> 'RETIRED'
      ${stationClause('t', filters.stationIds)}
    order by t.station_id, t.code
  `);
  const mapped = rows.map((row) => ({
    stationId: row.station_id,
    tankId: row.tank_id,
    tankCode: row.tank_code,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    capacityLitres: formatLitres(row.capacity),
    reorderLevelLitres: row.reorder_level === null ? null : formatLitres(row.reorder_level),
    acceptableVarianceLitres:
      row.acceptable_variance === null ? null : formatLitres(row.acceptable_variance),
    varianceRedLitres: row.variance_red === null ? null : formatLitres(row.variance_red),
    expectedLitres: formatLitres(row.expected),
    physicalLitres: row.physical === null ? null : formatLitres(row.physical),
    varianceLitres: row.variance === null ? null : formatLitres(row.variance),
    deliveryLitres: formatLitres(row.delivery_litres),
    deliveryValue: formatMoney(row.delivery_value),
    movementIds: uniqueIds(row.movement_ids ?? []),
    deliveryIds: uniqueIds(row.delivery_ids ?? []),
  }));
  return {
    expectedLitres: formatLitres(sumExact(mapped.map((row) => row.expectedLitres))),
    physicalLitres: (() => {
      const total = sumObservedExact(mapped.map((row) => row.physicalLitres));
      return total === null ? null : formatLitres(total);
    })(),
    varianceLitres: (() => {
      const total = sumObservedExact(mapped.map((row) => row.varianceLitres));
      return total === null ? null : formatLitres(total);
    })(),
    deliveryLitres: formatLitres(sumExact(mapped.map((row) => row.deliveryLitres))),
    deliveryValue: formatMoney(sumExact(mapped.map((row) => row.deliveryValue))),
    rows: mapped,
  };
}

async function readExpenses(transaction: ReportingTransaction, filters: ManagementReportQuery) {
  const rows = await transaction.execute<{
    business_date: string;
    station_id: string;
    category: string;
    classification: ReportExpenseClassification;
    description: string;
    payee: string | null;
    reference: string | null;
    state: string | null;
    source_type: 'EXPENSE' | 'RECURRING_COST_RECOGNITION';
    amount: string;
    expense_ids: string[] | null;
    recurring_recognition_ids: string[] | null;
    template_id: string | null;
    source_ids: string[] | null;
    movement_ids: string[] | null;
    attachment_ids: string[] | null;
  }>(sql`
    select m.recognition_date as business_date, m.station_id, c.code as category, m.classification,
      coalesce(e.description, t.name, 'Recognized expense') as description,
      e.payee, e.reference, coalesce(e.state, r.state) as state, m.source_type,
      coalesce(sum(case when m.movement_type = 'REVERSAL' then -m.amount else m.amount end), 0)::text as amount,
      coalesce(array_agg(distinct m.source_id order by m.source_id) filter (where m.source_type = 'EXPENSE'), ARRAY[]::uuid[]) as expense_ids,
      coalesce(array_agg(distinct m.source_id order by m.source_id) filter (where m.source_type = 'RECURRING_COST_RECOGNITION'), ARRAY[]::uuid[]) as recurring_recognition_ids,
      max(p.template_id::text) as template_id,
      coalesce(array_agg(distinct m.source_id order by m.source_id), ARRAY[]::uuid[]) as source_ids,
      coalesce(array_agg(m.id order by m.id), ARRAY[]::uuid[]) as movement_ids,
      coalesce(attachments.attachment_ids, ARRAY[]::uuid[]) as attachment_ids
    from app.expense_recognition_movements m
    join app.expense_categories c on c.tenant_id = m.tenant_id and c.id = m.category_id
    left join app.expenses e on e.tenant_id = m.tenant_id
      and e.id = m.source_id and m.source_type = 'EXPENSE'
    left join app.recurring_cost_recognitions r on r.tenant_id = m.tenant_id
      and r.id = m.source_id and m.source_type = 'RECURRING_COST_RECOGNITION'
    left join app.recurring_cost_periods p on p.tenant_id = r.tenant_id and p.id = r.period_id
    left join app.recurring_cost_templates t on t.tenant_id = p.tenant_id and t.id = p.template_id
    left join lateral (
      select array_agg(a.id order by a.id) as attachment_ids
      from app.expense_attachments a
      where a.tenant_id = e.tenant_id and a.expense_id = e.id
    ) attachments on true
    where m.tenant_id = ${filters.tenantId}
      and m.recognition_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('m', filters.stationIds)}
    group by m.recognition_date, m.station_id, c.code, m.classification,
      e.description, t.name, e.payee, e.reference, e.state, r.state, m.source_type,
      attachments.attachment_ids, m.source_id
    order by m.recognition_date, m.station_id, c.code, m.classification, m.source_id
  `);
  const mapped = rows.map((row) => ({
    businessDate: row.business_date,
    stationId: row.station_id,
    category: row.category,
    classification: row.classification,
    description: row.description,
    payee: row.payee,
    reference: row.reference,
    state: row.state,
    amount: formatMoney(row.amount),
    expenseIds: uniqueIds(row.expense_ids ?? []),
    recurringRecognitionIds: uniqueIds(row.recurring_recognition_ids ?? []),
    templateId: row.template_id,
    sourceIds: uniqueIds(row.source_ids ?? []),
    recognitionMovementIds: uniqueIds(row.movement_ids ?? []),
    attachmentIds: uniqueIds(row.attachment_ids ?? []),
    sourceType: row.source_type,
  }));
  const templates = await transaction.execute<{
    id: string;
    station_id: string;
    category: string;
    name: string;
    amount: string;
    start_date: string;
    end_date: string | null;
  }>(sql`
    select t.id, t.station_id, c.code as category, t.name, t.amount::text,
      t.start_date, t.end_date
    from app.recurring_cost_templates t
    join app.expense_categories c on c.tenant_id = t.tenant_id and c.id = t.category_id
    where t.tenant_id = ${filters.tenantId}
      and t.status = 'ACTIVE'
      and t.start_date <= ${filters.toDate}
      and (t.end_date is null or t.end_date >= ${filters.fromDate})
      ${stationClause('t', filters.stationIds)}
  `);
  const recognised = new Set(
    mapped
      .filter((row) => row.sourceType === 'RECURRING_COST_RECOGNITION' && row.templateId)
      .map((row) => `${row.stationId}:${row.businessDate}:${row.templateId}`),
  );
  for (const template of templates) {
    const first = template.start_date > filters.fromDate ? template.start_date : filters.fromDate;
    const last =
      template.end_date && template.end_date < filters.toDate ? template.end_date : filters.toDate;
    for (const date of datesBetween(first, last)) {
      const key = `${template.station_id}:${date}:${template.id}`;
      if (recognised.has(key)) continue;
      if (!fixedCostIsActiveOnDate(date, template.start_date, template.end_date)) continue;
      const amount = fixedCostAmountForDate(template.amount, date);
      mapped.push({
        businessDate: date,
        stationId: template.station_id,
        category: template.category,
        classification: 'FIXED_COST',
        description: `${template.name} (daily allocation)`,
        payee: null,
        reference: null,
        state: 'RECOGNIZED',
        amount: formatMoney(amount),
        expenseIds: [],
        recurringRecognitionIds: [],
        sourceIds: [],
        recognitionMovementIds: [],
        attachmentIds: [],
        sourceType: 'RECURRING_COST_RECOGNITION',
        templateId: template.id,
      });
    }
  }
  const totalFor = (classification: ReportExpenseClassification) =>
    formatMoney(
      sumExact(
        mapped.filter((row) => row.classification === classification).map((row) => row.amount),
      ),
    );
  return {
    total: formatMoney(sumExact(mapped.map((row) => row.amount))),
    operatingTotal: totalFor('OPERATING'),
    fixedCostTotal: totalFor('FIXED_COST'),
    directInventoryCostTotal: totalFor('DIRECT_INVENTORY_COST'),
    rows: mapped,
  };
}

async function readDaily(
  transaction: ReportingTransaction,
  filters: ManagementReportQuery,
): Promise<readonly DailyOperationsRow[]> {
  const base = approvedReconciliations(filters);
  const rows = await transaction.execute<{
    report_date: string;
    station_id: string;
    station_code: string;
    litres: string;
    sales_value: string;
    cash_declared: string;
    cash_variance: string;
    collected: string;
    banked: string;
    provider_evidence: string;
    provider_settled: string;
    provider_outstanding: string;
    expenses: string;
    inventory_variance: string | null;
    deliveries: string;
    credit_evidence: string;
    prepaid_evidence: string;
    reconciliation_ids: string[] | null;
    collection_ids: string[] | null;
    deposit_ids: string[] | null;
    settlement_ids: string[] | null;
    delivery_ids: string[] | null;
  }>(sql`
    with approved as (${base}),
    sales as (
      select a.business_date as report_date, a.station_id, sum(m.litres_sold)::text as litres,
        (select sum(a2.accounted_sales) from approved a2
          where a2.business_date = a.business_date and a2.station_id = a.station_id)::text as sales_value,
        array_agg(distinct a.reconciliation_id) as reconciliation_ids
      from approved a left join app.reconciliation_meter_readings m on m.tenant_id = ${filters.tenantId}
        and m.station_id = a.station_id and m.reconciliation_id = a.reconciliation_id
      group by a.business_date, a.station_id
    ), payments as (
      select a.business_date as report_date, a.station_id,
        coalesce(sum(p.amount) filter (where p.method = 'CASH'), 0)::text as cash_declared,
        coalesce(sum(p.amount) filter (where p.method in ('POS','ECOCASH')), 0)::text as provider_evidence,
        coalesce(sum(p.amount) filter (where p.method = 'CUSTOMER_CREDIT'), 0)::text as credit_evidence,
        coalesce(sum(p.amount) filter (where p.method = 'PREPAID'), 0)::text as prepaid_evidence
      from approved a left join app.reconciliation_payments p on p.tenant_id = ${filters.tenantId}
        and p.station_id = a.station_id and p.reconciliation_id = a.reconciliation_id
      group by a.business_date, a.station_id
    ), cash_variances as (
      select a.business_date as report_date, a.station_id, coalesce(sum(c.cash_variance), 0)::text as cash_variance
      from approved a left join app.reconciliation_cash_declarations c on c.tenant_id = ${filters.tenantId}
        and c.station_id = a.station_id and c.reconciliation_id = a.reconciliation_id
      group by a.business_date, a.station_id
    ), collections as (
      select c.business_date as report_date, c.station_id, sum(c.amount)::text as collected,
        array_agg(distinct c.id) as collection_ids
      from app.cash_collections c
      where c.tenant_id = ${filters.tenantId} and c.state <> 'REVERSED'
        and c.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('c', filters.stationIds)}
      group by c.business_date, c.station_id
    ), banked as (
      select to_char(d.deposited_at at time zone 'UTC', 'YYYY-MM-DD') as report_date,
        d.station_id, sum(a.amount)::text as banked, array_agg(distinct d.id) as deposit_ids
      from app.bank_deposits d
      join app.bank_deposit_allocations a on a.tenant_id = d.tenant_id
        and a.station_id = d.station_id and a.deposit_id = d.id
      where d.tenant_id = ${filters.tenantId} and d.state = 'CONFIRMED'
        and d.deposited_at >= (${filters.fromDate}::date at time zone 'UTC')
        and d.deposited_at < ((${filters.toDate}::date + interval '1 day') at time zone 'UTC')
        ${stationClause('d', filters.stationIds)}
      group by to_char(d.deposited_at at time zone 'UTC', 'YYYY-MM-DD'), d.station_id
    ), settlements as (
      select s.settlement_date as report_date, s.station_id, sum(s.gross_amount)::text as provider_settled,
        sum(s.gross_amount - coalesce(a.allocated, 0))::text as provider_outstanding,
        array_agg(s.id) as settlement_ids
      from app.provider_settlements s left join (
        select settlement_id, sum(amount) filter (where state = 'POSTED') as allocated
        from app.provider_settlement_allocations allocation
        where allocation.tenant_id = ${filters.tenantId}
          and allocation.state = 'POSTED'
          and not exists (
            select 1
            from app.provider_settlement_allocations reversal
            where reversal.tenant_id = allocation.tenant_id
              and reversal.reversal_of_id = allocation.id
              and reversal.state = 'REVERSED'
          )
        group by settlement_id
      ) a on a.settlement_id = s.id
      where s.tenant_id = ${filters.tenantId} and s.settlement_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('s', filters.stationIds)}
      group by s.settlement_date, s.station_id
    ), expenses as (
      select a.business_date as report_date, a.station_id, sum(e.amount)::text as expenses
      from approved a join app.reconciliation_expenses e on e.tenant_id = ${filters.tenantId}
        and e.station_id = a.station_id and e.reconciliation_id = a.reconciliation_id
      group by a.business_date, a.station_id
    ), deliveries as (
      select d.station_id, d.business_date as report_date, sum(d.actual_quantity_litres)::text as deliveries, array_agg(d.id) as delivery_ids
      from app.fuel_deliveries d where d.tenant_id = ${filters.tenantId} and d.status = 'CONFIRMED'
        and d.business_date between ${filters.fromDate} and ${filters.toDate}
      group by d.station_id, d.business_date
    ), station_tanks as (
      select t.station_id, count(*)::integer as tank_count
      from app.tanks t
      where t.tenant_id = ${filters.tenantId} and t.status <> 'RETIRED'
        ${stationClause('t', filters.stationIds)}
      group by t.station_id
    ), inventory_variance as (
      select d.station_id, d.business_date as report_date,
        case when count(distinct d.tank_id) = max(st.tank_count)
          then sum(d.physical_litres - coalesce((select sum(m.quantity_litres) from app.inventory_movements m
          where m.tenant_id = d.tenant_id and m.station_id = d.station_id and m.tank_id = d.tank_id
            and m.effective_at <= d.measured_at), 0))::text
          else null end as inventory_variance
      from app.tank_dips d
      join app.tanks t on t.tenant_id = d.tenant_id and t.station_id = d.station_id
        and t.id = d.tank_id and t.status <> 'RETIRED'
      join station_tanks st on st.station_id = d.station_id
      where d.tenant_id = ${filters.tenantId}
        and d.business_date between ${filters.fromDate} and ${filters.toDate}
      group by d.station_id, d.business_date
    ), keys as (
      select report_date, station_id from sales union select report_date, station_id from payments
      union select report_date, station_id from collections union select report_date, station_id from banked
      union select report_date, station_id from settlements union select report_date, station_id from deliveries
      union select report_date, station_id from expenses union select report_date, station_id from inventory_variance
    )
    select k.report_date, k.station_id, st.code as station_code,
      coalesce(s.litres, '0') as litres, coalesce(s.sales_value, '0') as sales_value,
      coalesce(p.cash_declared, '0') as cash_declared, coalesce(cv.cash_variance, '0') as cash_variance,
      coalesce(c.collected, '0') as collected, coalesce(b.banked, '0') as banked,
      coalesce(p.provider_evidence, '0') as provider_evidence,
      coalesce(se.provider_settled, '0') as provider_settled,
      coalesce(se.provider_outstanding, '0') as provider_outstanding,
      coalesce(e.expenses, '0') as expenses, iv.inventory_variance,
      coalesce(d.deliveries, '0') as deliveries, coalesce(p.credit_evidence, '0') as credit_evidence,
      coalesce(p.prepaid_evidence, '0') as prepaid_evidence,
      coalesce(s.reconciliation_ids, ARRAY[]::uuid[]) as reconciliation_ids,
      coalesce(c.collection_ids, ARRAY[]::uuid[]) as collection_ids,
      coalesce(b.deposit_ids, ARRAY[]::uuid[]) as deposit_ids,
      coalesce(se.settlement_ids, ARRAY[]::uuid[]) as settlement_ids,
      coalesce(d.delivery_ids, ARRAY[]::uuid[]) as delivery_ids
    from keys k join app.stations st on st.tenant_id = ${filters.tenantId} and st.id = k.station_id
    left join sales s on s.report_date = k.report_date and s.station_id = k.station_id
    left join payments p on p.report_date = k.report_date and p.station_id = k.station_id
    left join cash_variances cv on cv.report_date = k.report_date and cv.station_id = k.station_id
    left join collections c on c.report_date = k.report_date and c.station_id = k.station_id
    left join banked b on b.report_date = k.report_date and b.station_id = k.station_id
    left join settlements se on se.report_date = k.report_date and se.station_id = k.station_id
    left join expenses e on e.report_date = k.report_date and e.station_id = k.station_id
    left join deliveries d on d.report_date = k.report_date and d.station_id = k.station_id
    left join inventory_variance iv on iv.report_date = k.report_date and iv.station_id = k.station_id
    ${filters.stationIds.length > 0 ? sql`where k.station_id in (${idList(filters.stationIds)})` : sql``}
    order by k.report_date, st.code
  `);
  const paymentsByDate = await transaction.execute<{
    business_date: string;
    station_id: string;
    method: string;
    amount: string;
    ids: string[] | null;
  }>(sql`
    with approved as (${base})
    select a.business_date, a.station_id, p.method, sum(p.amount)::text as amount,
      array_agg(p.id) as ids
    from approved a join app.reconciliation_payments p on p.tenant_id = ${filters.tenantId}
      and p.station_id = a.station_id and p.reconciliation_id = a.reconciliation_id
    group by a.business_date, a.station_id, p.method
    order by a.business_date, a.station_id, p.method
  `);
  return rows.map((row) => ({
    reportDate: row.report_date,
    stationId: row.station_id,
    stationCode: row.station_code,
    litresSold: formatLitres(row.litres),
    salesValue: formatMoney(row.sales_value),
    paymentBreakdown: paymentsByDate
      .filter(
        (payment) =>
          payment.business_date === row.report_date && payment.station_id === row.station_id,
      )
      .map((payment) => ({
        method: payment.method,
        amount: formatMoney(payment.amount),
        evidenceIds: uniqueIds(payment.ids ?? []),
      })),
    cashDeclared: formatMoney(row.cash_declared),
    cashVariance: formatMoney(row.cash_variance),
    collectedCash: formatMoney(row.collected),
    bankedCash: formatMoney(row.banked),
    providerEvidence: formatMoney(row.provider_evidence),
    providerSettledAmount: formatMoney(row.provider_settled),
    providerOutstandingAmount: formatMoney(row.provider_outstanding),
    recordedExpenses: formatMoney(row.expenses),
    inventoryVariance:
      row.inventory_variance === null ? null : formatLitres(row.inventory_variance),
    deliveryLitres: formatLitres(row.deliveries),
    customerCreditEvidence: formatMoney(row.credit_evidence),
    prepaidEvidence: formatMoney(row.prepaid_evidence),
    reconciliationIds: uniqueIds(row.reconciliation_ids ?? []),
    collectionIds: uniqueIds(row.collection_ids ?? []),
    depositIds: uniqueIds(row.deposit_ids ?? []),
    settlementIds: uniqueIds(row.settlement_ids ?? []),
    deliveryIds: uniqueIds(row.delivery_ids ?? []),
  }));
}

const dateBasis: ReportDateBasis = {
  sales: 'A5 business date',
  recognizedRevenue: 'REV1 sale_recognition_movements.business_date',
  cashEvidence: 'A5 business date',
  cashCollections: 'A6 cash_collections.business_date',
  bankedCash: 'A6 bank_deposits.deposited_at UTC calendar date',
  providerEvidence: 'A5 business date',
  providerSettlements: 'A9 settlement date',
  suppliers: 'A7 effective_date <= toDate; balance as of toDate',
  customers: 'A8 balance as of toDate using ledger business_date and authorization requested_at',
  inventory: 'A4 movement business date and latest dip measured_at as of toDate',
  expenses: 'expense_recognition_movements.recognition_date',
  dailyRecordedExpenses: 'A5 business date',
};

/**
 * The authorisation every report action shares (view, share, export): an
 * authenticated tenant member who may view every requested station. One denial
 * rejects the whole request.
 */
async function reportingAuthority(request: Request, filters: ManagementReportQuery) {
  if (process.env.CONSOLIDATED_CONTEXT_READS !== '1') {
    const authority = await resolveTenantExecutionContext({
      request,
      requestedTenantId: filters.tenantId,
    });
    return { authority, rows: [] };
  }
  return resolveTenantReadAuthority({ request, tenantId: filters.tenantId });
}
async function reportingStations(
  read: Awaited<ReturnType<typeof reportingAuthority>>,
  filters: ManagementReportQuery,
) {
  if (filters.stationIds.length === 0) return [];
  const stations = filters.stationIds.flatMap((id) => {
    const row = read.rows.find((row) => row.station_id === id && row.legal_entity_id);
    return row?.station_id && row.legal_entity_id
      ? [{ id: row.station_id, legalEntityId: row.legal_entity_id }]
      : [];
  });
  if (stations.length === filters.stationIds.length) return stations;
  return withTenantTransaction(read.authority.transaction, (transaction) =>
    selectedStations(transaction, filters),
  );
}
/**
 * Whether this person holds finance-report access anywhere in the organisation, so the Reports
 * page can leave finance reports out of the list. It only shapes the page; every report
 * request authorises again.
 */
export async function canViewFinanceReports(request: Request, tenantId: string): Promise<boolean> {
  const authority = await resolveTenantExecutionContext({ request, requestedTenantId: tenantId });
  return authority.authorization.roleAssignments.some((assignment) =>
    DEFAULT_ROLE_PERMISSIONS[assignment.roleCode].includes('report.finance.view'),
  );
}

export async function authorizeManagementReportRequest(
  request: Request,
  input: unknown,
  permissionCode: ReportPermission = 'report.finance.view',
) {
  const filters = parseManagementReportQuery(input);
  const read = await reportingAuthority(request, filters);
  const stations = await reportingStations(read, filters);
  authorizeStations(read.authority.authorization, filters, stations, permissionCode);
  return { filters, authority: read.authority, stations };
}

export async function getDashboardSalesFromRequest(request: Request, input: unknown) {
  const { filters, authority, stations } = await authorizeManagementReportRequest(
    request,
    input,
    'report.view',
  );
  const single = stations.length === 1 ? stations[0] : undefined;
  const context = single
    ? createTrustedTenantTransactionContext({
        ...authority.transaction,
        legalEntityId: single.legalEntityId,
        stationId: single.id,
      })
    : authority.transaction;
  return withTenantTransaction(context, async (transaction) => ({
    sales: await readSales(transaction, filters),
  }));
}

export async function getManagementReportFromRequest(
  request: Request,
  input: unknown,
  options: { requireStepUp?: boolean } = {},
): Promise<ManagementReport> {
  const { filters, authority, stations } = await authorizeManagementReportRequest(request, input);
  // Exports leave the application, so they need a fresh step-up for this tenant.
  if (options.requireStepUp) {
    assertStepUp(authority.actor.session, 1, new Date(), filters.tenantId);
  }
  // One station keeps the station-scoped transaction context; several stations
  // are each authorised above and then bounded by the explicit station filter.
  const [single] = stations;
  const reportTransactionContext =
    stations.length === 1 && single
      ? createTrustedTenantTransactionContext({
          ...authority.transaction,
          legalEntityId: single.legalEntityId,
          stationId: single.id,
        })
      : authority.transaction;
  const legalEntityIds = [...new Set(stations.map((station) => station.legalEntityId))].sort();
  return withTenantTransaction(reportTransactionContext, async (transaction) => {
    const [
      stations,
      sales,
      cash,
      providers,
      suppliers,
      customers,
      inventory,
      expenses,
      costing,
      revenue,
      ownerPosition,
    ] = await Promise.all([
      listStations(transaction, filters),
      readSales(transaction, filters),
      readCash(transaction, filters),
      readProviders(transaction, filters),
      readSuppliers(transaction, filters, legalEntityIds),
      readCustomers(transaction, filters),
      readInventory(transaction, filters),
      readExpenses(transaction, filters),
      readRestatedCogs(transaction, filters),
      readCanonicalRevenue(transaction, filters),
      readOwnerPosition(transaction, filters, legalEntityIds),
    ]);
    const profitability = buildProfitabilityReport({
      tenantId: filters.tenantId,
      stationIds: filters.stationIds,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      revenue,
      costing,
    });
    return {
      report: 'MANAGEMENT_OVERVIEW',
      state: 'POSTED',
      currency: 'USD',
      filters: {
        tenantId: filters.tenantId,
        stationIds: filters.stationIds,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      },
      dateBasis,
      stations,
      sales,
      cash,
      providers,
      suppliers,
      customers,
      inventory,
      expenses,
      revenue,
      costing,
      fuelProfit: profitability.fuelProfit,
      ownerPosition,
      grossMargin: profitability.grossMargin,
    };
  });
}

export async function getDailyOperationsFromRequest(
  request: Request,
  input: unknown,
): Promise<{
  report: 'DAILY_OPERATIONS';
  state: 'POSTED';
  filters: ManagementReport['filters'];
  dateBasis: ReportDateBasis;
  rows: readonly DailyOperationsRow[];
}> {
  const filters = parseManagementReportQuery(input);
  const read = await reportingAuthority(request, filters);
  const stations =
    process.env.CONSOLIDATED_CONTEXT_READS === '1' ? await reportingStations(read, filters) : null;
  const authority = read.authority;
  if (stations) authorizeStations(authority.authorization, filters, stations, 'report.view');
  return withTenantTransaction(authority.transaction, async (transaction) => {
    if (!stations)
      authorizeStations(
        authority.authorization,
        filters,
        await selectedStations(transaction, filters),
        'report.view',
      );
    return {
      report: 'DAILY_OPERATIONS' as const,
      state: 'POSTED' as const,
      filters: {
        tenantId: filters.tenantId,
        stationIds: filters.stationIds,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      },
      dateBasis,
      rows: await readDaily(transaction, filters),
    };
  });
}
