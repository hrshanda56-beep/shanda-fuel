import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import { resolveForecourtCommandContext, type ForecourtCommandContext } from './application';
import { loadForecourtStation } from './persistence';
import {
  pickCurrentShift,
  type MyShiftBoundary,
  type MyShiftData,
  type MyShiftMeter,
} from './my-shift-state';

const uuid = z.string().uuid();

export const myShiftQuery = z.object({ tenantId: uuid, stationId: uuid });

type MyShiftInput = z.infer<typeof myShiftQuery>;

type ShiftRow = {
  id: string;
  businessDayId: string;
  label: string | null;
  state: string;
  businessDayState: string;
  plannedStartAt: Date | string;
  plannedEndAt: Date | string;
  version: number | string;
};

/**
 * The attendant's own view of the current shift at one station.
 *
 * It is guarded by exactly the permissions an attendant holds
 * (`station.view`, `shift.view`, `meter.view`) and deliberately exposes no
 * prices, sales, customers, cash or reconciliation data. Tenant, legal entity
 * and station come from the trusted A1 context, never from the caller.
 */
export async function getMyShiftFromRequest(
  request: Request,
  input: MyShiftInput,
): Promise<MyShiftData> {
  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
  for (const permissionCode of ['station.view', 'shift.view', 'meter.view'] as const) {
    authorize({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
  }
  const canCapture = isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode: 'meter.boundary.capture',
    requestedScope: context.scope,
  });

  return withTenantTransaction(context.authority.transaction, (transaction) =>
    loadMyShift(transaction, context, input, canCapture),
  );
}

async function loadMyShift(
  transaction: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  context: ForecourtCommandContext,
  input: MyShiftInput,
  canCapture: boolean,
): Promise<MyShiftData> {
  const stationRows = await transaction.execute<{ id: string; name: string; timezone: string }>(sql`
    select id, name, timezone
    from app.stations
    where tenant_id = ${context.tenantId} and id = ${input.stationId}
  `);
  const station = stationRows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');

  const clock = await transaction.execute<{ now: Date | string }>(sql`select now() as now`);
  const nowIso = new Date(clock[0]!.now).toISOString();

  const shiftRows = await transaction.execute<ShiftRow>(sql`
    select s.id, s.business_day_id as "businessDayId", t.name as label, s.state,
           d.state as "businessDayState", s.planned_start_at as "plannedStartAt",
           s.planned_end_at as "plannedEndAt", s.version
    from app.shifts s
    join app.station_business_days d
      on d.tenant_id = s.tenant_id and d.station_id = s.station_id and d.id = s.business_day_id
    left join app.shift_templates t
      on t.tenant_id = s.tenant_id and t.station_id = s.station_id and t.id = s.shift_template_id
    where s.tenant_id = ${context.tenantId}
      and s.station_id = ${input.stationId}
      and s.planned_end_at > now() - interval '14 hours'
      and s.planned_start_at < now() + interval '14 hours'
    order by s.planned_start_at, s.id
    limit 12
  `);

  const normalised = shiftRows.map((row) => ({
    ...row,
    plannedStartAt: new Date(row.plannedStartAt).toISOString(),
    plannedEndAt: new Date(row.plannedEndAt).toISOString(),
    version: Number(row.version),
  }));
  const shift = pickCurrentShift(normalised, Date.parse(nowIso));

  const base = {
    station,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    now: nowIso,
    responsibleAttendantId: context.actor.membershipId,
    canCapture,
  };
  if (!shift) return { ...base, shift: null, meters: [] };

  const meterRows = await transaction.execute<{
    nozzleId: string;
    pumpNumber: string;
    nozzleNumber: string;
    productName: string;
    meterInstallationId: string | null;
    previousReading: string | null;
  }>(sql`
    select n.id as "nozzleId", p.number as "pumpNumber", n.number as "nozzleNumber",
           product.name as "productName", installation.id as "meterInstallationId",
           previous.reading_value as "previousReading"
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
        and mi.effective_from <= ${shift.plannedStartAt}::timestamptz
        and (mi.effective_to is null or mi.effective_to > ${shift.plannedEndAt}::timestamptz)
      order by mi.effective_from desc, mi.id desc
      limit 1
    ) installation on true
    left join lateral (
      select b.reading_value
      from app.meter_boundaries b
      where b.tenant_id = n.tenant_id and b.station_id = n.station_id
        and b.nozzle_id = n.id and b.reading_status = 'AVAILABLE'
        and b.shift_id <> ${shift.id}
      order by b.effective_at desc, b.id desc
      limit 1
    ) previous on true
    where n.tenant_id = ${context.tenantId}
      and n.station_id = ${input.stationId}
      and n.status = 'ACTIVE'
    order by p.number, n.number, n.id
  `);

  const boundaryRows = await transaction.execute<{
    nozzleId: string;
    reason: string;
    readingStatus: string;
    readingValue: string | null;
    confirmedAt: Date | string;
  }>(sql`
    select nozzle_id as "nozzleId", reason, reading_status as "readingStatus",
           reading_value as "readingValue", confirmed_at as "confirmedAt"
    from app.meter_boundaries
    where tenant_id = ${context.tenantId}
      and station_id = ${input.stationId}
      and shift_id = ${shift.id}
      and reason in ('SHIFT_OPEN', 'SHIFT_CLOSE')
    order by effective_at, id
  `);

  const boundaryFor = (nozzleId: string, reason: string): MyShiftBoundary | null => {
    const rows = boundaryRows.filter((row) => row.nozzleId === nozzleId && row.reason === reason);
    const available = [...rows].reverse().find((row) => row.readingStatus === 'AVAILABLE');
    if (available) {
      return {
        status: 'RECORDED',
        value: String(available.readingValue),
        recordedAt: new Date(available.confirmedAt).toISOString(),
      };
    }
    const unavailable = rows.at(-1);
    return unavailable
      ? { status: 'UNAVAILABLE', recordedAt: new Date(unavailable.confirmedAt).toISOString() }
      : null;
  };

  const meters: MyShiftMeter[] = meterRows.map((row) => ({
    nozzleId: row.nozzleId,
    meterInstallationId: row.meterInstallationId,
    pumpNumber: row.pumpNumber,
    nozzleNumber: row.nozzleNumber,
    productName: row.productName,
    previousReading: row.previousReading === null ? null : String(row.previousReading),
    opening: boundaryFor(row.nozzleId, 'SHIFT_OPEN'),
    closing: boundaryFor(row.nozzleId, 'SHIFT_CLOSE'),
  }));

  return {
    ...base,
    shift: {
      id: shift.id,
      businessDayId: shift.businessDayId,
      label: shift.label,
      state: shift.state,
      businessDayState: shift.businessDayState,
      plannedStartAt: shift.plannedStartAt,
      plannedEndAt: shift.plannedEndAt,
      version: shift.version,
    },
    meters,
  };
}
