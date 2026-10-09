import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { deriveBusinessDate } from '@/platform/domain/business-time';
import { withTenantTransaction } from '@/platform/db/transaction';
import type { Database } from '@/platform/db';
import { authorize } from '@/platform/security';
import { resolveForecourtCommandContext, type ForecourtCommandContext } from './application';
import { loadForecourtStation } from './persistence';

export const attendantHomeQuery = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
});

export type AttendantHome = {
  station: { id: string; code: string; name: string; timezone: string };
  businessDay: { id: string; date: string; state: string } | null;
  shift: {
    id: string;
    state: string;
    plannedStartAt: string;
    plannedEndAt: string;
  } | null;
  readings: Array<{
    id: string;
    pumpNumber: string;
    nozzleNumber: string;
    productName: string;
    readingStatus: string;
    readingValue: string | null;
    reason: string;
  }>;
  captureRequired: boolean;
  needsAttention: boolean;
};

export async function getAttendantHomeFromRequest(
  request: Request,
  input: z.infer<typeof attendantHomeQuery>,
): Promise<AttendantHome> {
  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'shift.view',
    requestedScope: context.scope,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'meter.view',
    requestedScope: context.scope,
  });

  return withTenantTransaction(context.authority.transaction, (transaction) =>
    loadAttendantHome(transaction, context),
  );
}

async function loadAttendantHome(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  context: ForecourtCommandContext,
): Promise<AttendantHome> {
  const stationRows = await transaction.execute<AttendantHome['station']>(sql`
    select id, code, name, timezone
    from app.stations
    where tenant_id = ${context.tenantId}
      and id = ${context.stationId}
  `);
  const station = stationRows[0];
  if (!station) throw new Error('The authorized station was not found');

  const nowRows = await transaction.execute<{ now: Date | string }>(
    sql`select clock_timestamp() as now`,
  );
  const businessDate = deriveBusinessDate(nowRows[0]?.now ?? new Date(), station.timezone);
  const dayRows = await transaction.execute<{
    id: string;
    date: string;
    state: string;
  }>(sql`
    select id, business_date as date, state
    from app.station_business_days
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and business_date = ${businessDate}
    limit 1
  `);
  const businessDay = dayRows[0] ?? null;

  const shiftRows = businessDay
    ? await transaction.execute<{
        id: string;
        state: string;
        plannedStartAt: Date | string;
        plannedEndAt: Date | string;
      }>(sql`
        select id,
               state,
               planned_start_at as "plannedStartAt",
               planned_end_at as "plannedEndAt"
        from app.shifts
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and business_day_id = ${businessDay.id}
        order by case when state = 'OPEN' then 0 when state = 'PLANNED' then 1 else 2 end,
                 planned_start_at
        limit 1
      `)
    : [];
  const shift = shiftRows[0]
    ? {
        id: shiftRows[0].id,
        state: shiftRows[0].state,
        plannedStartAt: new Date(shiftRows[0].plannedStartAt).toISOString(),
        plannedEndAt: new Date(shiftRows[0].plannedEndAt).toISOString(),
      }
    : null;

  const readings = shift
    ? await transaction.execute<{
        id: string;
        pumpNumber: string;
        nozzleNumber: string;
        productName: string;
        readingStatus: string;
        readingValue: string | null;
        reason: string;
      }>(sql`
        select b.id,
               p.number as "pumpNumber",
               n.number as "nozzleNumber",
               product.name as "productName",
               b.reading_status as "readingStatus",
               b.reading_value as "readingValue",
               b.reason
        from app.meter_boundaries b
        join app.nozzles n
          on n.tenant_id = b.tenant_id and n.station_id = b.station_id and n.id = b.nozzle_id
        join app.pumps p
          on p.tenant_id = n.tenant_id and p.station_id = n.station_id and p.id = n.pump_id
        join app.products product
          on product.tenant_id = n.tenant_id and product.id = n.product_id
        where b.tenant_id = ${context.tenantId}
          and b.station_id = ${context.stationId}
          and b.shift_id = ${shift.id}
          and b.attendant_id = ${context.authority.membership.membershipId}
        order by p.number, n.number, b.effective_at desc
      `)
    : [];

  return {
    station,
    businessDay,
    shift,
    readings: readings.map((reading) => ({
      ...reading,
      readingValue: reading.readingValue === null ? null : String(reading.readingValue),
    })),
    captureRequired: Boolean(
      shift && (shift.state === 'OPEN' || shift.state === 'PLANNED') && readings.length === 0,
    ),
    needsAttention: readings.some((reading) => reading.readingStatus === 'UNAVAILABLE'),
  };
}
