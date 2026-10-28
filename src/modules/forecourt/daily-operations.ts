import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import {
  resolveForecourtCommandContext,
  type ForecourtCommandContext,
  type ForecourtTransaction,
} from './application';
import { loadForecourtStation } from './persistence';
import { authorize } from '../../platform/security/permissions';

const uuid = z.string().uuid();
// A3 transitions prices through approval and station activation; A5 meter
// evidence accepts only the terminal ACTIVE state.
const operationalSellingPriceState = 'ACTIVE' as const;

export const dailyOperationsQuery = z.object({
  tenantId: uuid,
  stationId: uuid,
  businessDayId: uuid,
  shiftId: uuid,
});

type DailyOperationsInput = z.infer<typeof dailyOperationsQuery>;

type DailyOperationsContext = {
  /** The signed-in person's membership, so unsent entries kept on a device stay with that person. */
  viewerMembershipId: string;
  station: { id: string; code: string; name: string; timezone: string };
  organisation: { id: string; name: string };
  businessDay: { id: string; date: string; state: string; version: number };
  reconciliationId: string | null;
  shift: {
    id: string;
    state: string;
    businessDate: string;
    plannedStartAt: string;
    plannedEndAt: string;
    version: number;
  };
  attendants: Array<{ id: string; name: string; email: string }>;
  availableReadings: Array<{
    nozzleId: string;
    pumpNumber: string;
    nozzleNumber: string;
    productId: string;
    productCode: string;
    productName: string;
    meterInstallationId: string | null;
    sellingPriceId: string | null;
    unitPrice: string | null;
    previousReading: string | null;
  }>;
};

export async function getDailyOperationsContextFromRequest(
  request: Request,
  input: DailyOperationsInput,
): Promise<DailyOperationsContext> {
  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
  // The composition read exposes the same station reconciliation evidence as
  // A5. Context resolution establishes tenant/station authority, but does
  // not grant a permission; keep the read explicitly guarded here.
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'reconciliation.view',
    requestedScope: context.scope,
  });

  return withTenantTransaction(context.authority.transaction, (transaction) =>
    loadDailyOperationsContext(transaction, context, input),
  );
}

async function loadDailyOperationsContext(
  transaction: ForecourtTransaction,
  context: ForecourtCommandContext,
  input: DailyOperationsInput,
): Promise<DailyOperationsContext> {
  const stationRows = await transaction.execute<
    DailyOperationsContext['station'] & { tenantId: string; tenantName: string }
  >(sql`
    select s.id, s.code, s.name, s.timezone, t.id as "tenantId", t.name as "tenantName"
    from app.stations s
    join app.tenants t on t.id = s.tenant_id
    where s.tenant_id = ${context.tenantId} and s.id = ${input.stationId}
  `);
  const station = stationRows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');

  const dayRows = await transaction.execute<{
    id: string;
    date: string;
    state: string;
    version: number | string;
  }>(sql`
    select id, business_date as date, state, version
    from app.station_business_days
    where tenant_id = ${context.tenantId}
      and station_id = ${input.stationId}
      and id = ${input.businessDayId}
  `);
  const day = dayRows[0];
  if (!day) throw new AppError('NOT_FOUND', 'The requested business day was not found');

  const shiftRows = await transaction.execute<{
    id: string;
    state: string;
    business_date: string;
    planned_start_at: Date | string;
    planned_end_at: Date | string;
    version: number | string;
  }>(sql`
    select id, state, business_date, planned_start_at, planned_end_at, version
    from app.shifts
    where tenant_id = ${context.tenantId}
      and station_id = ${input.stationId}
      and business_day_id = ${input.businessDayId}
      and id = ${input.shiftId}
  `);
  const shift = shiftRows[0];
  if (!shift) throw new AppError('NOT_FOUND', 'The requested shift was not found');
  const shiftStart = new Date(shift.planned_start_at).toISOString();
  const shiftEnd = new Date(shift.planned_end_at).toISOString();

  const [attendants, readings] = await Promise.all([
    transaction.execute<{ id: string; name: string; email: string }>(sql`
      select m.id, u.name, u.email
      from app.memberships m
      join app.users u on u.id = m.identity_id
      join app.membership_role_assignments a
        on a.tenant_id = m.tenant_id and a.membership_id = m.id
      where m.tenant_id = ${context.tenantId}
        and m.status = 'ACTIVE'
        and a.scope_type = 'STATION'
        and a.station_id = ${input.stationId}
        and a.role_code = 'ATTENDANT'
        and (a.expires_at is null or a.expires_at > ${shiftStart}::timestamptz)
      order by u.name, m.id
    `),
    transaction.execute<DailyOperationsContext['availableReadings'][number]>(sql`
      select n.id as "nozzleId", p.number as "pumpNumber", n.number as "nozzleNumber",
             product.id as "productId", product.code as "productCode", product.name as "productName",
             installation.id as "meterInstallationId", price.id as "sellingPriceId",
             price.unit_price as "unitPrice", previous.reading_value as "previousReading"
      from app.nozzles n
      join app.pumps p
        on p.tenant_id = n.tenant_id and p.station_id = n.station_id and p.id = n.pump_id
      join app.products product
        on product.tenant_id = n.tenant_id and product.id = n.product_id
      left join lateral (
        select mi.id
        from app.meter_installations mi
        where mi.tenant_id = n.tenant_id and mi.station_id = n.station_id
          and mi.nozzle_id = n.id
          and mi.effective_from <= ${shiftStart}::timestamptz
          and (mi.effective_to is null or mi.effective_to > ${shiftEnd}::timestamptz)
        order by mi.effective_from desc, mi.id desc
        limit 1
      ) installation on true
      left join lateral (
        select sp.id, sp.unit_price
        from app.selling_prices sp
        where sp.tenant_id = n.tenant_id and sp.station_id = n.station_id
          and sp.product_id = n.product_id and sp.state = ${operationalSellingPriceState}
          and sp.effective_from <= ${shiftStart}::timestamptz
          and (sp.effective_to is null or sp.effective_to > ${shiftEnd}::timestamptz)
        order by sp.effective_from desc, sp.id desc
        limit 1
      ) price on true
      left join lateral (
        select b.reading_value
        from app.meter_boundaries b
        where b.tenant_id = n.tenant_id and b.station_id = n.station_id
          and b.nozzle_id = n.id and b.reading_status = 'AVAILABLE'
          and b.effective_at <= ${shiftStart}::timestamptz
        order by b.effective_at desc, b.id desc
        limit 1
      ) previous on true
      where n.tenant_id = ${context.tenantId}
        and n.station_id = ${input.stationId}
        and n.status = 'ACTIVE'
      order by p.number, n.number, n.id
    `),
  ]);

  return {
    viewerMembershipId: context.authority.membership.membershipId,
    station: {
      id: station.id,
      code: station.code,
      name: station.name,
      timezone: station.timezone,
    },
    organisation: { id: station.tenantId, name: station.tenantName },
    businessDay: {
      id: day.id,
      date: day.date,
      state: day.state,
      version: Number(day.version),
    },
    reconciliationId:
      (
        await transaction.execute<{ id: string }>(sql`
          select id
          from app.reconciliations
          where tenant_id = ${context.tenantId}
            and station_id = ${input.stationId}
            and shift_id = ${input.shiftId}
          order by id
          limit 1
        `)
      )[0]?.id ?? null,
    shift: {
      id: shift.id,
      state: shift.state,
      businessDate: shift.business_date,
      plannedStartAt: shiftStart,
      plannedEndAt: shiftEnd,
      version: Number(shift.version),
    },
    attendants,
    availableReadings: readings.map((row) => ({
      ...row,
      unitPrice: row.unitPrice === null ? null : String(row.unitPrice),
      previousReading: row.previousReading === null ? null : String(row.previousReading),
    })),
  };
}
