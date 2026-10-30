import 'server-only';
import { sql } from 'drizzle-orm';
import type { InventoryCommandContext, InventoryTransaction } from '../inventory/application';
import { isPermissionGranted } from '../../platform/security/permissions';
import {
  alertSettingsFromRow,
  type AlertSettings,
  type AlertSettingsRow,
  type TankAlertFacts,
} from './operations-alerts';

/** How far back late reports and cash shortages are looked for. Older days are the accounts' job. */
const LOOKBACK_DAYS = 14;

export type OperationsReportFacts = Readonly<{
  unsubmittedDates: readonly string[];
  closedUnreconciledDates: readonly string[];
  cashShortages: readonly { businessDate: string; amount: string }[];
}>;

/**
 * Read-only facts for the operations alerts at one station. Every date is the station's own
 * calendar (its timezone from station data), never the browser's or the server's. A part the
 * person may not see comes back `null`, not empty, so it is never shown as "all clear".
 */
export async function loadOperationsFacts(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  options: { lookbackDays?: number } = {},
): Promise<{
  today: string;
  reports: OperationsReportFacts | null;
  tanks: readonly TankAlertFacts[] | null;
  settings: AlertSettings;
}> {
  const can = (permissionCode: 'reconciliation.view' | 'inventory.view') =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
  const tz = context.stationTimezone;
  const lookbackDays = options.lookbackDays ?? LOOKBACK_DAYS;
  const [todayRow] = await transaction.execute<{ today: string }>(sql`
    select (now() at time zone ${tz})::date::text as today`);
  const today = todayRow!.today;

  let reports: OperationsReportFacts | null = null;
  if (can('reconciliation.view')) {
    const days = await transaction.execute<{ business_date: string; state: string }>(sql`
      select bd.business_date::text as business_date, bd.state
      from app.station_business_days bd
      where bd.tenant_id = ${context.tenantId} and bd.station_id = ${context.stationId}
        and bd.state in ('OPEN', 'OPERATIONS_COMPLETE', 'CLOSED', 'LOCKED')
        and bd.business_date::date >= ${today}::date - ${lookbackDays}::int
        and exists (
          select 1 from app.shifts s
          where s.tenant_id = bd.tenant_id and s.station_id = bd.station_id
            and s.business_day_id = bd.id
            and s.state not in ('PLANNED', 'NOT_OPERATED', 'CANCELLED_BEFORE_START'))
        and not exists (
          select 1 from app.reconciliations r
          where r.tenant_id = bd.tenant_id and r.station_id = bd.station_id
            and r.business_day_id = bd.id
            and r.state in ('SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'LOCKED'))
      order by bd.business_date`);
    const shortages = await transaction.execute<{ business_date: string; amount: string }>(sql`
      select bd.business_date::text as business_date,
        (-sum(c.cash_variance))::text as amount
      from app.reconciliation_cash_declarations c
      join app.reconciliations r on r.tenant_id = c.tenant_id and r.station_id = c.station_id
        and r.id = c.reconciliation_id
      join app.station_business_days bd on bd.tenant_id = r.tenant_id
        and bd.station_id = r.station_id and bd.id = r.business_day_id
      where c.tenant_id = ${context.tenantId} and c.station_id = ${context.stationId}
        and r.state in ('SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'LOCKED')
        and bd.business_date::date >= ${today}::date - ${lookbackDays}::int
      group by bd.business_date
      having sum(c.cash_variance) < 0
      order by bd.business_date desc`);
    reports = {
      unsubmittedDates: days.map((row) => row.business_date),
      closedUnreconciledDates: days
        .filter((row) => row.state === 'CLOSED' || row.state === 'LOCKED')
        .map((row) => row.business_date),
      cashShortages: shortages.map((row) => ({
        businessDate: row.business_date,
        amount: row.amount,
      })),
    };
  }

  let tanks: TankAlertFacts[] | null = null;
  if (can('inventory.view')) {
    const rows = await transaction.execute<{
      tank_id: string;
      tank_code: string;
      product_name: string;
      expected: string;
      physical: string | null;
      variance: string | null;
      tolerance: string | null;
      red: string | null;
      sold: string | null;
      reorder: string | null;
      opening_recorded: boolean;
    }>(sql`
      select t.id as tank_id, t.code as tank_code, p.name as product_name,
        coalesce(now_stock.expected, 0)::text as expected,
        d.physical_litres::text as physical,
        -- A day's sales reach the books when its report is approved. Until then the dip is ahead of
        -- the books by that day's sales, which is a report waiting, not a leak, so it is not compared.
        case when exists (
          select 1 from app.reconciliations r
          join app.station_business_days bd
            on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
          where r.tenant_id = t.tenant_id and r.station_id = t.station_id
            and r.state = 'SUBMITTED' and bd.business_date <= d.business_date
        ) then null
        else (d.physical_litres - coalesce(at_dip.expected, 0))::text end as variance,
        t.acceptable_variance_litres::text as tolerance,
        t.variance_red_litres::text as red,
        sold.litres::text as sold,
        t.reorder_level_litres::text as reorder,
        exists (select 1 from app.inventory_movements o
          where o.tenant_id = t.tenant_id and o.station_id = t.station_id
            and o.tank_id = t.id and o.movement_type = 'OPENING_BALANCE') as opening_recorded
      from app.tanks t
      join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
      left join lateral (
        select sum(m.quantity_litres) as expected from app.inventory_movements m
        where m.tenant_id = t.tenant_id and m.station_id = t.station_id
          and m.tank_id = t.id and m.product_id = t.product_id
      ) now_stock on true
      left join lateral (
        select physical_litres, measured_at, business_date from app.tank_dips d
        where d.tenant_id = t.tenant_id and d.station_id = t.station_id and d.tank_id = t.id and d.voided_at is null
        order by d.measured_at desc, d.id desc limit 1
      ) d on true
      left join lateral (
        select sum(m.quantity_litres) as expected from app.inventory_movements m
        where m.tenant_id = t.tenant_id and m.station_id = t.station_id
          and m.tank_id = t.id and m.product_id = t.product_id
          and m.business_date <= d.business_date
      ) at_dip on true
      left join lateral (
        select -sum(m.quantity_litres) as litres from app.inventory_movements m
        where m.tenant_id = t.tenant_id and m.station_id = t.station_id
          and m.tank_id = t.id and m.product_id = t.product_id
          and m.movement_type = 'SALE'
          and m.business_date <= d.business_date
          and m.effective_at > coalesce((
            select p.measured_at from app.tank_dips p
            where p.tenant_id = t.tenant_id and p.station_id = t.station_id
              and p.tank_id = t.id and p.voided_at is null and p.measured_at < d.measured_at
            order by p.measured_at desc, p.id desc limit 1), '-infinity'::timestamptz)
      ) sold on true
      where t.tenant_id = ${context.tenantId} and t.station_id = ${context.stationId}
        and t.status = 'ACTIVE'
      order by t.code`);
    tanks = rows.map((row) => ({
      tankId: row.tank_id,
      tankCode: row.tank_code,
      productName: row.product_name,
      expectedLitres: row.expected,
      physicalLitres: row.physical,
      varianceAtDipLitres: row.variance,
      toleranceLitres: row.tolerance,
      redLitres: row.red,
      soldSincePreviousDipLitres: row.sold,
      reorderLevelLitres: row.reorder,
      openingStockRecorded: row.opening_recorded,
    }));
  }
  const [settingsRow] = await transaction.execute<AlertSettingsRow>(sql`
    select due_soon_days, pos_settlement_lag_days, report_grace_days,
           cash_shortage_minimum::text as cash_shortage_minimum
    from app.alert_settings where tenant_id = ${context.tenantId}`);
  return { today, reports, tanks, settings: alertSettingsFromRow(settingsRow) };
}
