import 'server-only';
import { sql } from 'drizzle-orm';
import type { InventoryCommandContext, InventoryTransaction } from '../inventory/application';
import { buildCustomerAlertFacts } from '../customers/alert-facts';
import { isPermissionGranted } from '../../platform/security/permissions';
import { SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD } from '../creditors/payment-proof';
import {
  APPROVED_INFORMATION_EVENT_CODES,
  DEFAULT_EXTRA_ALERT_SETTINGS,
  type ExtraAlertFacts,
  type ExtraAlertSettings,
} from './extra-alerts';

/**
 * Read-only facts for the extra alerts at one station. Every part the person may not see comes
 * back `null` (never empty), so it is never shown as "all clear". Dates are the station's own.
 */
export async function loadExtraAlertFacts(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  today: string,
  settings: ExtraAlertSettings = DEFAULT_EXTRA_ALERT_SETTINGS,
): Promise<ExtraAlertFacts> {
  const can = (
    permissionCode:
      | 'cash.collection.view'
      | 'expense.view'
      | 'reconciliation.view'
      | 'inventory.view'
      | 'audit.view'
      | 'supplier.view'
      | 'customer.statement.view',
  ) =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
  const lookback = settings.lookbackDays;
  const { tenantId, stationId } = context;

  const unbankedCash = can('cash.collection.view')
    ? (
        await transaction.execute<{ reference: string; business_date: string; amount: string }>(sql`
      select c.collection_reference as reference, c.business_date,
        (c.amount - coalesce((
          select sum(a.amount) from app.bank_deposit_allocations a
          join app.bank_deposits d on d.tenant_id = a.tenant_id and d.station_id = a.station_id
            and d.id = a.deposit_id
          where a.tenant_id = c.tenant_id and a.station_id = c.station_id
            and a.collection_id = c.id and d.state = 'CONFIRMED'), 0))::text as amount
      from app.cash_collections c
      where c.tenant_id = ${tenantId} and c.station_id = ${stationId}
        and c.state in ('RECORDED', 'RECEIVED')
      order by c.business_date, c.id`)
      )
        .filter((row) => !/^0+(?:\.0+)?$/.test(row.amount))
        .map((row) => ({
          reference: row.reference,
          businessDate: row.business_date,
          amount: row.amount,
        }))
    : null;

  const expenses = can('expense.view')
    ? (
        await transaction.execute<{
          id: string;
          expense_date: string;
          description: string;
          amount: string;
        }>(sql`
      select e.id, e.expense_date, e.description, e.amount::text as amount
      from app.expenses e
      where e.tenant_id = ${tenantId} and e.station_id = ${stationId}
        and e.state in ('SUBMITTED', 'APPROVED', 'POSTED')
        and e.expense_date::date >= ${today}::date - ${lookback}::int
        and e.amount >= ${settings.highExpenseAmount}::numeric
      order by e.expense_date desc, e.amount desc, e.id
      limit 20`)
      ).map((row) => ({
        id: row.id,
        expenseDate: row.expense_date,
        description: row.description,
        amount: row.amount,
      }))
    : null;

  const belowPriceSales = can('reconciliation.view')
    ? (
        await transaction.execute<{
          business_date: string;
          product: string;
          sold_price: string;
          approved_price: string;
          litres: string;
        }>(sql`
      select bd.business_date, p.name as product, mr.unit_price::text as sold_price,
        sp.unit_price::text as approved_price, sum(mr.litres_sold)::text as litres
      from app.reconciliation_meter_readings mr
      join app.reconciliations r on r.tenant_id = mr.tenant_id and r.station_id = mr.station_id
        and r.id = mr.reconciliation_id
      join app.station_business_days bd on bd.tenant_id = r.tenant_id
        and bd.station_id = r.station_id and bd.id = r.business_day_id
      join app.selling_prices sp on sp.tenant_id = mr.tenant_id and sp.id = mr.selling_price_id
      join app.products p on p.tenant_id = mr.tenant_id and p.id = mr.product_id
      where mr.tenant_id = ${tenantId} and mr.station_id = ${stationId}
        and r.state in ('SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'LOCKED')
        and bd.business_date::date >= ${today}::date - ${lookback}::int
        and mr.unit_price < sp.unit_price
      group by bd.business_date, p.name, mr.unit_price, sp.unit_price
      order by bd.business_date desc, p.name
      limit 20`)
      ).map((row) => ({
        businessDate: row.business_date,
        product: row.product,
        soldPrice: row.sold_price,
        approvedPrice: row.approved_price,
        litres: row.litres,
      }))
    : null;

  const shortDeliveries = can('inventory.view')
    ? (
        await transaction.execute<{
          id: string;
          business_date: string;
          product: string;
          delivery_note: string;
          short: string;
        }>(sql`
      select f.id, f.business_date, p.name as product, f.delivery_note_number as delivery_note,
        (-f.shortage_excess_litres)::text as short
      from app.fuel_deliveries f
      join app.products p on p.tenant_id = f.tenant_id and p.id = f.product_id
      where f.tenant_id = ${tenantId} and f.station_id = ${stationId} and f.status = 'CONFIRMED'
        and f.business_date::date >= ${today}::date - ${lookback}::int
        and f.shortage_excess_litres < 0
      order by f.business_date desc, f.id
      limit 20`)
      ).map((row) => ({
        id: row.id,
        businessDate: row.business_date,
        product: row.product,
        deliveryNote: row.delivery_note,
        shortLitres: row.short,
      }))
    : null;

  const negativeStock = can('inventory.view')
    ? (
        await transaction.execute<{
          tank_id: string;
          tank_code: string;
          product: string;
          litres: string;
        }>(sql`
      select t.id as tank_id, t.code as tank_code, p.name as product,
        sum(m.quantity_litres)::text as litres
      from app.inventory_movements m
      join app.tanks t on t.tenant_id = m.tenant_id and t.station_id = m.station_id and t.id = m.tank_id
      join app.products p on p.tenant_id = m.tenant_id and p.id = m.product_id
      where m.tenant_id = ${tenantId} and m.station_id = ${stationId}
      group by t.id, t.code, p.name
      having sum(m.quantity_litres) < 0
      order by sum(m.quantity_litres), t.code
      limit 20`)
      ).map((row) => ({
        tankId: row.tank_id,
        tankCode: row.tank_code,
        product: row.product,
        litres: row.litres,
      }))
    : null;

  const unprovenSupplierPayments = can('supplier.view')
    ? (
        await transaction.execute<{
          id: string;
          supplier_id: string;
          supplier_name: string;
          payment_date: string;
          reference: string;
          amount: string;
        }>(sql`
      select p.id, p.supplier_id, s.legal_name as supplier_name, p.payment_date,
        p.payment_reference as reference, p.amount::text as amount
      from app.supplier_payments p
      join app.suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
      where p.tenant_id = ${tenantId} and p.legal_entity_id = ${context.legalEntityId}
        and p.state in ('SUBMITTED', 'POSTED')
        and p.amount >= ${SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD}::numeric
        and not exists (select 1 from app.documents d
          where d.tenant_id = p.tenant_id and d.subject_type = 'SUPPLIER_PAYMENT'
            and d.subject_id = p.id)
      order by p.payment_date desc, p.id
      limit 20`)
      ).map((row) => ({
        id: row.id,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        paymentDate: row.payment_date,
        reference: row.reference,
        amount: row.amount,
      }))
    : null;

  let approvedInformationChanges: number | null = null;
  if (can('audit.view')) {
    const codes = sql.join(
      APPROVED_INFORMATION_EVENT_CODES.map((code) => sql`${code}`),
      sql`, `,
    );
    const [row] = await transaction.execute<{ total: string }>(sql`
      select count(*)::text as total from platform.security_events e
      where e.tenant_id = ${tenantId} and e.event_code in (${codes})
        and e.occurred_at >= now() - (${lookback}::int * interval '1 day')`);
    approvedInformationChanges = Number(row?.total ?? 0);
  }

  const dipReminders = can('inventory.view')
    ? await (async () => {
        const rows = await transaction.execute<{
          shift_id: string;
          kind: 'OPENING' | 'CLOSING';
          tank_code: string;
        }>(sql`
      select s.id as shift_id, k.kind, t.code as tank_code
      from app.shifts s
      join app.tanks t on t.tenant_id = s.tenant_id and t.station_id = s.station_id
        and t.status = 'ACTIVE'
      cross join lateral (values ('OPENING'), ('CLOSING')) as k(kind)
      where s.tenant_id = ${tenantId} and s.station_id = ${stationId} and s.state = 'OPEN'
        and (
          (k.kind = 'OPENING' and s.opened_at is not null
            and now() >= s.opened_at + interval '30 minutes'
            and not exists (select 1 from app.tank_dips d
              where d.tenant_id = t.tenant_id and d.station_id = t.station_id
                and d.tank_id = t.id and d.voided_at is null and d.measured_at >= s.opened_at - interval '60 minutes'))
          or (k.kind = 'CLOSING' and now() >= s.planned_end_at - interval '30 minutes'
            and not exists (select 1 from app.tank_dips d
              where d.tenant_id = t.tenant_id and d.station_id = t.station_id
                and d.tank_id = t.id and d.voided_at is null and d.measured_at >= s.planned_end_at - interval '30 minutes'))
        )
      order by s.planned_end_at, s.id, k.kind, t.code`);
        const grouped = new Map<
          string,
          { shiftId: string; kind: 'OPENING' | 'CLOSING'; tankCodes: string[] }
        >();
        for (const row of rows) {
          const key = `${row.shift_id}:${row.kind}`;
          const entry = grouped.get(key) ?? {
            shiftId: row.shift_id,
            kind: row.kind,
            tankCodes: [],
          };
          entry.tankCodes.push(row.tank_code);
          grouped.set(key, entry);
        }
        return [...grouped.values()];
      })()
    : null;

  let customerOverdue: ExtraAlertFacts['customerOverdue'] = null;
  let customerOverLimit: ExtraAlertFacts['customerOverLimit'] = null;
  if (can('customer.statement.view')) {
    const accounts = await transaction.execute<{
      account_id: string;
      customer_id: string;
      display_name: string;
      credit_limit: string | null;
      credit_days: number | null;
      staff_name: string | null;
    }>(sql`
      select a.id as account_id, c.id as customer_id, c.display_name,
             a.credit_limit::text as credit_limit, a.credit_days, t.staff_name
      from app.customer_accounts a
      join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      left join app.customer_staff_benefit_terms t
        on t.tenant_id = a.tenant_id and t.account_id = a.id
      where a.tenant_id = ${tenantId} and a.account_type = 'CREDIT' and a.status = 'ACTIVE'`);
    const ledger = await transaction.execute<{
      account_id: string;
      id: string;
      direction: 'INCREASE' | 'DECREASE';
      entry_type: string;
      business_date: string;
      amount: string;
      reversal_of_entry_id: string | null;
    }>(sql`
      select l.account_id, l.id, l.direction, l.entry_type, l.business_date,
             l.amount::text as amount, l.reversal_of_entry_id
      from app.customer_ledger_entries l
      join app.customer_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${tenantId} and l.account_type = 'CREDIT' and a.status = 'ACTIVE'
        and l.business_date::date <= ${today}::date
      order by l.account_id, l.business_date, l.occurred_at, l.id`);
    type Line = Parameters<typeof buildCustomerAlertFacts>[0][number]['lines'][number];
    const byAccount = new Map<string, Line[]>();
    for (const row of ledger) {
      const list = byAccount.get(row.account_id) ?? [];
      list.push({
        id: row.id,
        direction: row.direction,
        entryType: row.entry_type,
        businessDate: row.business_date,
        amount: row.amount,
        reversalOfEntryId: row.reversal_of_entry_id,
      });
      byAccount.set(row.account_id, list);
    }
    const built = buildCustomerAlertFacts(
      accounts.map((row) => ({
        accountId: row.account_id,
        customerId: row.customer_id,
        customerName: row.display_name,
        limit: row.credit_limit,
        creditDays: row.credit_days === null ? null : Number(row.credit_days),
        isStaffBenefit: row.staff_name !== null,
        staffName: row.staff_name,
        lines: byAccount.get(row.account_id) ?? [],
      })),
      today,
    );
    customerOverdue = built.overdue;
    customerOverLimit = built.overLimit;
  }

  return {
    today,
    customerOverdue,
    customerOverLimit,
    unbankedCash,
    expenses,
    belowPriceSales,
    shortDeliveries,
    negativeStock,
    approvedInformationChanges,
    unprovenSupplierPayments,
    dipReminders,
  };
}
