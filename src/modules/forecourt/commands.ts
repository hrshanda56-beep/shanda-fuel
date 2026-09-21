import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { meterSegments } from '../../platform/db/schema/a3';
import { executeForecourtCommand } from './application';
import { databaseForecourtPorts, loadForecourtStation } from './persistence';
import { meterSegmentSealedEvent } from './contracts';
import { sealMeterSegment, type MeterBoundary } from './domain';
import { resolveForecourtCommandContext } from './application';

const sealSegmentPayload = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  segmentId: z.string().uuid(),
  nozzleId: z.string().uuid(),
  meterInstallationId: z.string().uuid(),
  businessDayId: z.string().uuid(),
  shiftId: z.string().uuid(),
  openingBoundaryId: z.string().uuid(),
  closingBoundaryId: z.string().uuid(),
  productId: z.string().uuid(),
  responsibleAttendantId: z.string().uuid(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  sealedAt: z.string().datetime(),
  controlledQuantityLitres: z.string().optional(),
  correctionOfSegmentId: z.string().uuid().optional(),
  reversalOfSegmentId: z.string().uuid().optional(),
  expectedVersion: z.number().int().nonnegative(),
});

type SealSegmentPayload = z.infer<typeof sealSegmentPayload>;

type BoundaryRow = {
  id: string;
  tenant_id: string;
  station_id: string;
  nozzle_id: string;
  meter_installation_id: string;
  business_day_id: string;
  shift_id: string;
  reason: MeterBoundary['reason'];
  reading_status: MeterBoundary['reading']['status'];
  reading_value: string | null;
  unavailable_reason: string | null;
  effective_at: Date;
  confirmed_at: Date;
  confirmed_by: string;
  entered_by: string;
  attendant_id: string;
  on_behalf_of: string | null;
  exception_reason: string | null;
  version: number;
};

function requestHash(payload: SealSegmentPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function boundaryFromRow(row: BoundaryRow): MeterBoundary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stationId: row.station_id,
    nozzleId: row.nozzle_id,
    meterInstallationId: row.meter_installation_id,
    businessDayId: row.business_day_id,
    shiftId: row.shift_id,
    reason: row.reason,
    reading:
      row.reading_status === 'AVAILABLE'
        ? { status: 'AVAILABLE', value: row.reading_value ?? '' }
        : { status: 'UNAVAILABLE', reason: row.unavailable_reason ?? '' },
    effectiveAt: row.effective_at.toISOString(),
    confirmedAt: row.confirmed_at.toISOString(),
    confirmedBy: row.confirmed_by,
    enteredBy: row.entered_by,
    attendantId: row.attendant_id,
    ...(row.on_behalf_of ? { onBehalfOf: row.on_behalf_of } : {}),
    ...(row.exception_reason ? { exceptionReason: row.exception_reason } : {}),
    version: row.version,
  };
}

/**
 * The production HTTP command seam. The operation is fixed by the route and
 * the server-owned policy, while all authoritative reads and the mutation use
 * one concrete tenant transaction and the durable A3 ports.
 */
export async function sealMeterSegmentFromRequest(
  request: Request,
  input: unknown,
): Promise<{ segmentId: string; eventId: string }> {
  const payload = sealSegmentPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');

  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
    loadStation: loadForecourtStation,
  });

  const ports = databaseForecourtPorts();
  return executeForecourtCommand({
    context,
    commandType: 'SealSegment',
    idempotencyKey,
    requestHash: requestHash(payload),
    subjectType: 'MeterSegment',
    subjectId: payload.meterInstallationId,
    responsibleAttendantId: payload.responsibleAttendantId,
    expectedVersion: payload.expectedVersion,
    ports,
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        business_day_id: string;
        business_date: string;
        business_day_state: string;
        shift_id: string;
        shift_business_date: string;
        shift_state: string;
        installation_id: string;
        nozzle_id: string;
        meter_id: string;
        installation_version: number;
        nozzle_station_id: string;
        product_id: string;
        opening_boundary_id: string;
        opening_version: number;
        closing_boundary_id: string;
        closing_version: number;
      }>(sql`
        select
          d.id as business_day_id, d.business_date, d.state as business_day_state,
          s.id as shift_id, s.business_date as shift_business_date, s.state as shift_state,
          i.id as installation_id, i.nozzle_id, i.meter_id, i.version as installation_version,
          n.station_id as nozzle_station_id, n.product_id,
          ob.id as opening_boundary_id, ob.version as opening_version,
          cb.id as closing_boundary_id, cb.version as closing_version
        from app.station_business_days d
        join app.shifts s on s.tenant_id = d.tenant_id and s.station_id = d.station_id and s.business_day_id = d.id
        join app.meter_installations i on i.tenant_id = d.tenant_id and i.station_id = d.station_id
        join app.nozzles n on n.tenant_id = i.tenant_id and n.station_id = i.station_id and n.id = i.nozzle_id
        join app.meters m on m.tenant_id = i.tenant_id and m.id = i.meter_id
        join app.meter_boundaries ob on ob.tenant_id = d.tenant_id and ob.station_id = d.station_id and ob.id = ${payload.openingBoundaryId}
        join app.meter_boundaries cb on cb.tenant_id = d.tenant_id and cb.station_id = d.station_id and cb.id = ${payload.closingBoundaryId}
        where d.tenant_id = ${context.tenantId}
          and d.station_id = ${context.stationId}
          and d.id = ${payload.businessDayId}
          and s.id = ${payload.shiftId}
          and i.id = ${payload.meterInstallationId}
          and n.id = ${payload.nozzleId}
          and n.product_id = ${payload.productId}
          and ob.business_day_id = d.id and ob.shift_id = s.id
          and cb.business_day_id = d.id and cb.shift_id = s.id
        order by d.id, s.id, i.id, ob.id, cb.id
        for update of d, s, i, n, ob, cb
      `);
      const row = rows[0];
      if (!row)
        throw new AppError('NOT_FOUND', 'The meter segment operational context was not found');
      if (row.business_day_state !== 'OPEN' || row.shift_state !== 'OPEN') {
        throw new AppError('CONFLICT', 'Meter segments require an open business day and shift');
      }
      if (row.business_date !== row.shift_business_date) {
        throw new AppError('INVARIANT_VIOLATION', 'Business day and shift dates must agree');
      }

      const boundaryRows = await transaction.execute<BoundaryRow>(sql`
        select * from app.meter_boundaries
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and id in (${sql.join([sql`${payload.openingBoundaryId}`, sql`${payload.closingBoundaryId}`], sql`, `)})
        order by effective_at, id
        for update
      `);
      const opening = boundaryRows.find((boundary) => boundary.id === payload.openingBoundaryId);
      const closing = boundaryRows.find((boundary) => boundary.id === payload.closingBoundaryId);
      if (!opening || !closing) throw new AppError('NOT_FOUND', 'Meter boundaries were not found');

      const activePrice = await transaction.execute<{ unit_price: string; currency: 'USD' }>(
        sql`
        select unit_price, currency
        from app.selling_prices
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and product_id = ${payload.productId}
          and state = 'ACTIVE'
          and effective_from <= ${payload.endAt}::timestamptz
          and (effective_to is null or effective_to > ${payload.startAt}::timestamptz)
        order by effective_from desc
        limit 1
        for update
      `,
      );
      const price = activePrice[0];
      if (!price)
        throw new AppError('CONFLICT', 'No active selling price covers the meter segment');

      const segment = sealMeterSegment({
        id: payload.segmentId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: payload.nozzleId,
        meterInstallationId: payload.meterInstallationId,
        meterId: row.meter_id,
        businessDayId: payload.businessDayId,
        shiftId: payload.shiftId,
        openingBoundary: boundaryFromRow(opening),
        closingBoundary: boundaryFromRow(closing),
        productId: payload.productId,
        attendantId: payload.responsibleAttendantId,
        actor: context.actor,
        unitPrice: price.unit_price,
        currency: price.currency,
        startAt: payload.startAt,
        endAt: payload.endAt,
        sealedAt: payload.sealedAt,
        controlledQuantityLitres: payload.controlledQuantityLitres,
        correctionOfSegmentId: payload.correctionOfSegmentId,
        reversalOfSegmentId: payload.reversalOfSegmentId,
      });
      const insertValues: typeof meterSegments.$inferInsert = {
        id: segment.id,
        tenantId: segment.tenantId,
        stationId: segment.stationId,
        nozzleId: segment.nozzleId,
        meterInstallationId: segment.meterInstallationId,
        businessDayId: segment.businessDayId,
        shiftId: segment.shiftId,
        openingBoundaryId: segment.openingBoundaryId,
        closingBoundaryId: segment.closingBoundaryId,
        productId: segment.productId,
        attendantId: segment.attendantId,
        enteredBy: segment.enteredBy,
        onBehalfOf: segment.onBehalfOf,
        correctionOfSegmentId: segment.correctionOfSegmentId,
        reversalOfSegmentId: segment.reversalOfSegmentId,
        openingReading: segment.openingReading,
        closingReading: segment.closingReading,
        litres: segment.litres.toString(),
        unitPrice: segment.unitPrice.toString(),
        expectedSaleValue: segment.expectedSaleValue.amount.toString(),
        currency: segment.currency,
        boundaryReason: segment.boundaryReason,
        segmentStartAt: new Date(segment.startAt),
        segmentEndAt: new Date(segment.endAt),
        sealedAt: new Date(segment.sealedAt),
      };
      await transaction.insert(meterSegments).values(insertValues);
      await transaction.execute(sql`
        update app.meter_installations
        set version = version + 1
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and id = ${payload.meterInstallationId}
      `);
      const eventId = randomUUID();
      return {
        result: { segmentId: segment.id, eventId },
        event: meterSegmentSealedEvent(eventId, segment, {
          legalEntityId: context.legalEntityId,
          businessDate: row.business_date,
          occurredAt: payload.sealedAt,
        }),
        after: segment,
      };
    },
  });
}
