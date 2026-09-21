import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { meterSegments } from '../../platform/db/schema/a3';
import { litres, money, unitPrice } from '../../platform/domain/primitives';
import { executeForecourtCommand } from './application';
import {
  databaseForecourtPorts,
  loadForecourtStation,
  loadPriceActivationBoundaries,
} from './persistence';
import {
  businessDayLockedEvent,
  meterSegmentSealedEvent,
  priceBoundaryActivatedEvent,
  reconciliationApprovedEvent,
  reconciliationPostedEvent,
  meterBoundaryCreatedEvent,
  meterReplacedEvent,
  reconciliationRevisionCorrectedEvent,
} from './contracts';
import {
  approvePriceChange,
  approveReconciliation,
  calculateReconciliation,
  confirmAttendantHandover,
  confirmBoundary,
  completeShift,
  closeMeters,
  finalizeBusinessDay,
  markOperationsComplete,
  markNotOperated,
  openBusinessDay,
  requestPriceChange,
  returnReconciliation,
  submitReconciliation,
  startShift,
  lockReconciliation,
  lockBusinessDay,
  postReconciliation,
  sealMeterSegment,
  replaceMeterInstallation,
  type MeterBoundary,
  type MeterSegment,
  type ReconciliationPaymentCategory,
  type ReconciliationRevision,
  type SellingPrice,
} from './domain';
import { resolveForecourtCommandContext } from './application';

const sealSegmentPayload = z.object({
  commandType: z.literal('SealSegment').optional(),
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
  expectedVersion: z.number().int().nonnegative(),
});

type SealSegmentPayload = z.infer<typeof sealSegmentPayload>;

const handoverPayload = z
  .object({
    commandType: z.literal('HandoverAttendant').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    boundaryId: z.string().uuid(),
    priorBoundaryId: z.string().uuid(),
    nozzleId: z.string().uuid(),
    meterInstallationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    shiftId: z.string().uuid(),
    newAttendantId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

type HandoverPayload = z.infer<typeof handoverPayload>;

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
  effective_at: Date | string;
  confirmed_at: Date | string;
  confirmed_by: string;
  entered_by: string;
  attendant_id: string;
  on_behalf_of: string | null;
  exception_reason: string | null;
  price_change_id: string | null;
  version: number;
};

function requestHash(payload: SealSegmentPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function genericRequestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export async function handoverAttendantFromRequest(request: Request, input: unknown) {
  const payload = handoverPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
    loadStation: loadForecourtStation,
  });
  return executeForecourtCommand({
    context,
    commandType: 'HandoverAttendant',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'MeterBoundary',
    subjectId: payload.boundaryId,
    expectedVersionSubjectId: payload.shiftId,
    expectedVersion: payload.expectedVersion,
    responsibleAttendantId: payload.newAttendantId,
    auditMetadata: {
      priorBoundaryId: payload.priorBoundaryId,
      nozzleId: payload.nozzleId,
      meterInstallationId: payload.meterInstallationId,
      businessDayId: payload.businessDayId,
      shiftId: payload.shiftId,
    },
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<
        BoundaryRow & {
          business_day_state: string;
          shift_state: string;
          business_date: string;
        }
      >(sql`
        select b.*, d.state as business_day_state, s.state as shift_state, d.business_date
        from app.meter_boundaries b
        join app.station_business_days d
          on d.tenant_id = b.tenant_id and d.station_id = b.station_id and d.id = b.business_day_id
        join app.shifts s
          on s.tenant_id = b.tenant_id and s.station_id = b.station_id and s.id = b.shift_id
        where b.tenant_id = ${context.tenantId}
          and b.station_id = ${context.stationId}
          and b.id = ${payload.priorBoundaryId}
          and b.nozzle_id = ${payload.nozzleId}
          and b.meter_installation_id = ${payload.meterInstallationId}
          and b.business_day_id = ${payload.businessDayId}
          and b.shift_id = ${payload.shiftId}
          and not exists (
            select 1 from app.meter_boundaries newer
            where newer.tenant_id = b.tenant_id
              and newer.station_id = b.station_id
              and newer.nozzle_id = b.nozzle_id
              and newer.meter_installation_id = b.meter_installation_id
              and newer.business_day_id = b.business_day_id
              and newer.shift_id = b.shift_id
              and newer.reading_status = 'AVAILABLE'
              and (newer.effective_at, newer.id) > (b.effective_at, b.id)
          )
        for update of b, d, s
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'The prior meter boundary was not found');
      if (row.business_day_state !== 'OPEN' || row.shift_state !== 'OPEN') {
        throw new AppError(
          'CONFLICT',
          'Attendant handover requires an open business day and shift',
        );
      }
      const now = await serverNow(transaction);
      const boundary = confirmAttendantHandover({
        id: payload.boundaryId,
        priorBoundary: boundaryFromRow(row),
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: payload.nozzleId,
        meterInstallationId: payload.meterInstallationId,
        businessDayId: payload.businessDayId,
        shiftId: payload.shiftId,
        newAttendantId: payload.newAttendantId,
        actor: context.actor,
        effectiveAt: now,
        confirmedAt: now,
      });
      await transaction.execute(sql`
        insert into app.meter_boundaries
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           reason, reading_status, reading_value, unavailable_reason, effective_at, confirmed_at,
           confirmed_by, entered_by, attendant_id, on_behalf_of, exception_reason, version)
        values
          (${boundary.id}, ${boundary.tenantId}, ${boundary.stationId}, ${boundary.nozzleId},
           ${boundary.meterInstallationId}, ${boundary.businessDayId}, ${boundary.shiftId},
           ${boundary.reason}, ${boundary.reading.status},
           ${boundary.reading.status === 'AVAILABLE' ? boundary.reading.value : null},
           ${boundary.reading.status === 'UNAVAILABLE' ? boundary.reading.reason : null},
           ${boundary.effectiveAt}::timestamptz, ${boundary.confirmedAt}::timestamptz,
           ${boundary.confirmedBy}, ${boundary.enteredBy}, ${boundary.attendantId},
           ${boundary.onBehalfOf ?? null}, ${boundary.exceptionReason ?? null}, ${boundary.version})
      `);
      await transaction.execute(sql`
        update app.shifts
        set version = version + 1
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.shiftId} and version = ${payload.expectedVersion}
      `);
      return { result: { boundaryId: boundary.id }, after: boundary };
    },
  });
}

async function serverNow(
  transaction: Parameters<Parameters<import('../../platform/db').Database['transaction']>[0]>[0],
): Promise<string> {
  const rows = await transaction.execute<{ server_now: Date | string }>(
    sql`select clock_timestamp() as server_now`,
  );
  const value = rows[0]?.server_now;
  if (!value)
    throw new AppError('DEPENDENCY_UNAVAILABLE', 'The database server clock is unavailable');
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const dayLifecyclePayload = z
  .object({
    commandType: z.literal('OpenBusinessDay').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function openBusinessDayFromRequest(request: Request, input: unknown) {
  const payload = dayLifecyclePayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'OpenBusinessDay',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'StationBusinessDay',
    subjectId: payload.businessDayId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        id: string;
        business_date: string;
        state: string;
        version: number;
      }>(sql`
        select id, business_date, state, version from app.station_business_days
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.businessDayId}
        for update
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Business day was not found');
      const day = openBusinessDay({
        id: row.id,
        tenantId: context.tenantId,
        stationId: context.stationId,
        date: row.business_date as never,
        state: row.state as 'NOT_STARTED',
        version: Number(row.version),
      });
      const now = await serverNow(transaction);
      await transaction.execute(sql`
        update app.station_business_days set state = 'OPEN', opened_at = ${now}::timestamptz,
          version = version + 1, updated_at = ${now}::timestamptz
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.businessDayId} and version = ${payload.expectedVersion}
      `);
      return { result: { businessDayId: day.id }, after: day };
    },
  });
}

const closeBusinessDayPayload = z
  .object({
    commandType: z.literal('CloseBusinessDay').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function closeBusinessDayFromRequest(request: Request, input: unknown) {
  const payload = closeBusinessDayPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'CloseBusinessDay',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'StationBusinessDay',
    subjectId: payload.businessDayId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        id: string;
        business_date: string;
        state: string;
        version: number;
      }>(sql`
        select id, business_date, state, version from app.station_business_days
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.businessDayId}
        for update
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Business day was not found');
      const incomplete = await transaction.execute<{ count: number }>(sql`
        select count(*)::int as count from app.shifts
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and business_day_id=${payload.businessDayId}
          and state not in ('COMPLETED','NOT_OPERATED','CANCELLED_BEFORE_START')
      `);
      const openSegments = await transaction.execute<{ count: number }>(sql`
        select count(*)::int as count from app.meter_segments
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and business_day_id=${payload.businessDayId} and state <> 'SEALED'
      `);
      const unavailable = await transaction.execute<{ count: number }>(sql`
        select count(*)::int as count from app.meter_boundaries unavailable_boundary
        where unavailable_boundary.tenant_id=${context.tenantId} and unavailable_boundary.station_id=${context.stationId} and unavailable_boundary.business_day_id=${payload.businessDayId} and unavailable_boundary.reading_status='UNAVAILABLE'
          and not exists (
            select 1 from app.meter_boundaries resolved
            where resolved.tenant_id=unavailable_boundary.tenant_id and resolved.station_id=unavailable_boundary.station_id
              and resolved.nozzle_id=unavailable_boundary.nozzle_id
              and resolved.effective_at > unavailable_boundary.effective_at
              and resolved.reading_status='AVAILABLE'
          )
      `);
      if (
        Number(incomplete[0]?.count ?? 0) ||
        Number(openSegments[0]?.count ?? 0) ||
        Number(unavailable[0]?.count ?? 0)
      )
        throw new AppError(
          'CONFLICT',
          'Operational completion, sealed segments, and meter exceptions are required before close',
        );
      const day = {
        id: row.id,
        tenantId: context.tenantId,
        stationId: context.stationId,
        date: row.business_date as never,
        state: row.state as 'OPEN',
        version: Number(row.version),
      };
      const operationsComplete = markOperationsComplete(day);
      const closed = finalizeBusinessDay(operationsComplete);
      const now = await serverNow(transaction);
      await transaction.execute(sql`
        update app.station_business_days set state='OPERATIONS_COMPLETE', version=version+1, updated_at=${now}::timestamptz
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.businessDayId} and version=${payload.expectedVersion}
      `);
      await transaction.execute(sql`
        update app.station_business_days set state='CLOSED', closed_at=${now}::timestamptz, version=version+1, updated_at=${now}::timestamptz
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.businessDayId} and version=${payload.expectedVersion + 1}
      `);
      return { result: { businessDayId: closed.id }, after: closed };
    },
  });
}

const shiftLifecyclePayload = z
  .object({
    commandType: z.string().optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    shiftId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
type ShiftLifecycleCommand = 'StartShift' | 'CloseMeters' | 'CompleteShift' | 'MarkNotOperated';

async function runShiftLifecycleCommand(
  request: Request,
  input: unknown,
  commandType: ShiftLifecycleCommand,
) {
  const payload = shiftLifecyclePayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType,
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'Shift',
    subjectId: payload.shiftId,
    expectedVersion: payload.expectedVersion,
    reason: payload.reason,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        id: string;
        business_date: string;
        day_state: string;
        shift_state: string;
        planned_start_at: Date | string;
        planned_end_at: Date | string;
        version: number;
      }>(sql`
        select s.id, s.business_date, d.state as day_state, s.state as shift_state,
          s.planned_start_at, s.planned_end_at, s.version
        from app.shifts s join app.station_business_days d
          on d.tenant_id = s.tenant_id and d.station_id = s.station_id and d.id = s.business_day_id
        where s.tenant_id = ${context.tenantId} and s.station_id = ${context.stationId}
          and s.business_day_id = ${payload.businessDayId} and s.id = ${payload.shiftId}
        for update of s, d
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Shift was not found');
      const shift = {
        id: row.id,
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: payload.businessDayId,
        state: row.shift_state as ShiftLifecycleCommand extends never ? never : 'PLANNED',
        plannedStartAt: new Date(row.planned_start_at).toISOString(),
        plannedEndAt: new Date(row.planned_end_at).toISOString(),
        businessDate: row.business_date as never,
        version: Number(row.version),
      };
      const day = {
        id: payload.businessDayId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        date: row.business_date as never,
        state: row.day_state as 'OPEN',
        version: 0,
      };
      const updated =
        commandType === 'StartShift'
          ? startShift(shift, day)
          : commandType === 'CloseMeters'
            ? closeMeters(shift)
            : commandType === 'CompleteShift'
              ? completeShift(shift)
              : markNotOperated(shift, payload.reason!);
      const now = await serverNow(transaction);
      const state = updated.state;
      const timestampColumn =
        commandType === 'StartShift'
          ? sql`, opened_at = ${now}::timestamptz`
          : commandType === 'CloseMeters'
            ? sql`, meter_closed_at = ${now}::timestamptz`
            : commandType === 'CompleteShift'
              ? sql`, completed_at = ${now}::timestamptz`
              : sql``;
      await transaction.execute(sql`
        update app.shifts set state = ${state}, version = version + 1 ${timestampColumn}
        ${commandType === 'MarkNotOperated' ? sql`, not_operated_reason = ${payload.reason}` : sql``}
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.shiftId} and version = ${payload.expectedVersion}
      `);
      return { result: { shiftId: shift.id, state }, after: updated };
    },
  });
}

export const startShiftFromRequest = (request: Request, input: unknown) =>
  runShiftLifecycleCommand(request, input, 'StartShift');
export const closeMetersFromRequest = (request: Request, input: unknown) =>
  runShiftLifecycleCommand(request, input, 'CloseMeters');
export const completeShiftFromRequest = (request: Request, input: unknown) =>
  runShiftLifecycleCommand(request, input, 'CompleteShift');
export const markNotOperatedFromRequest = (request: Request, input: unknown) =>
  runShiftLifecycleCommand(request, input, 'MarkNotOperated');

const boundaryCommandPayload = z
  .object({
    commandType: z
      .enum([
        'ConfirmBoundary',
        'ConfirmPriceChangeBoundary',
        'ReportMeterUnavailable',
        'ResolveMeterException',
      ])
      .optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    boundaryId: z.string().uuid(),
    nozzleId: z.string().uuid(),
    meterInstallationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    shiftId: z.string().uuid(),
    responsibleAttendantId: z.string().uuid(),
    reason: z.enum([
      'SHIFT_OPEN',
      'SHIFT_CLOSE',
      'PRICE_CHANGE',
      'DELIVERY',
      'METER_RESET',
      'REPLACEMENT',
      'CORRECTION',
    ]),
    readingStatus: z.enum(['AVAILABLE', 'UNAVAILABLE']),
    readingValue: z.string().optional(),
    unavailableReason: z.string().optional(),
    exceptionReason: z.string().optional(),
    priceChangeId: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function confirmBoundaryFromRequest(request: Request, input: unknown) {
  const payload = boundaryCommandPayload.parse(input);
  const commandType = payload.commandType ?? 'ConfirmBoundary';
  const highImpactReasons = new Set(['PRICE_CHANGE', 'METER_RESET', 'REPLACEMENT', 'CORRECTION']);
  if (
    (commandType === 'ConfirmBoundary' ||
      commandType === 'ReportMeterUnavailable' ||
      commandType === 'ResolveMeterException') &&
    highImpactReasons.has(payload.reason)
  ) {
    throw new AppError('FORBIDDEN', 'High-impact meter boundaries require their named command');
  }
  if (commandType === 'ConfirmPriceChangeBoundary') {
    if (payload.reason !== 'PRICE_CHANGE' || !payload.priceChangeId) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Price-change boundary confirmation requires the PRICE_CHANGE reason and priceChangeId',
      );
    }
  } else if (payload.priceChangeId) {
    throw new AppError(
      'FORBIDDEN',
      'Only the named price-change boundary command may supply a price-change target',
    );
  }
  if (commandType === 'ReportMeterUnavailable' && payload.readingStatus !== 'UNAVAILABLE')
    throw new AppError(
      'VALIDATION_FAILED',
      'ReportMeterUnavailable requires an unavailable observation',
    );
  if (commandType === 'ResolveMeterException' && payload.readingStatus !== 'AVAILABLE')
    throw new AppError(
      'VALIDATION_FAILED',
      'ResolveMeterException requires a confirmed available reading',
    );
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType,
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'MeterBoundary',
    subjectId: payload.boundaryId,
    expectedVersionSubjectId:
      commandType === 'ConfirmPriceChangeBoundary' ? payload.priceChangeId : payload.shiftId,
    expectedVersion: payload.expectedVersion,
    responsibleAttendantId: payload.responsibleAttendantId,
    auditMetadata: {
      nozzleId: payload.nozzleId,
      meterInstallationId: payload.meterInstallationId,
      businessDayId: payload.businessDayId,
      shiftId: payload.shiftId,
    },
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const contextRows = await transaction.execute<{
        business_date: string;
        day_state: string;
        shift_state: string;
      }>(sql`
        select d.business_date, d.state as day_state, s.state as shift_state
        from app.station_business_days d join app.shifts s
          on s.tenant_id=d.tenant_id and s.station_id=d.station_id and s.business_day_id=d.id
        where d.tenant_id=${context.tenantId} and d.station_id=${context.stationId}
          and d.id=${payload.businessDayId} and s.id=${payload.shiftId}
        for update of d, s
      `);
      const row = contextRows[0];
      if (!row || row.day_state !== 'OPEN' || row.shift_state !== 'OPEN')
        throw new AppError('CONFLICT', 'Boundary capture requires an open business day and shift');
      const prior = await transaction.execute<BoundaryRow>(sql`
        select * from app.meter_boundaries
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and nozzle_id=${payload.nozzleId} and meter_installation_id=${payload.meterInstallationId}
          and reading_status='AVAILABLE'
        order by effective_at desc, id desc limit 1 for update
      `);
      if (commandType === 'ConfirmPriceChangeBoundary') {
        const targetPrice = await transaction.execute<{
          id: string;
          product_id: string;
          effective_from: Date | string;
        }>(sql`
          select id, product_id, effective_from
          from app.selling_prices
          where tenant_id=${context.tenantId}
            and station_id=${context.stationId}
            and id=${payload.priceChangeId}
          for update
        `);
        if (!targetPrice[0]) throw new AppError('NOT_FOUND', 'The price change was not found');
        await transaction.execute(sql`
          select id from app.products
          where tenant_id=${context.tenantId} and id=${targetPrice[0].product_id}
          for update
        `);
        const priceRows = await transaction.execute<{
          id: string;
          product_id: string;
          state: string;
          version: number;
          effective_from: Date | string;
        }>(sql`
          select p.id, p.product_id, p.state, p.version, p.effective_from
          from app.selling_prices p
          join app.nozzles n
            on n.tenant_id = p.tenant_id and n.station_id = p.station_id and n.product_id = p.product_id
          where p.tenant_id = ${context.tenantId}
            and p.station_id = ${context.stationId}
            and p.id = ${payload.priceChangeId}
            and n.id = ${payload.nozzleId}
            and n.status = 'ACTIVE'
          for update of p, n
        `);
        const price = priceRows[0];
        if (!price || price.product_id === undefined) {
          throw new AppError(
            'FORBIDDEN',
            'The price change does not belong to this station/nozzle product',
          );
        }
        if (
          price.state !== 'PENDING_STATION_ACTIVATION' &&
          price.state !== 'BOUNDARIES_IN_PROGRESS'
        ) {
          throw new AppError(
            'CONFLICT',
            'Only the current approved price activation cycle can create boundaries',
          );
        }
        if (Number(price.version) !== payload.expectedVersion) {
          throw new AppError('CONFLICT', 'The price-change version is stale');
        }
        const newerCycles = await transaction.execute<{ id: string }>(sql`
          select id
          from app.selling_prices
          where tenant_id=${context.tenantId}
            and station_id=${context.stationId}
            and product_id=${price.product_id}
            and state in ('APPROVED', 'SCHEDULED', 'PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS', 'ACTIVE')
            and (effective_from, id) > (${price.effective_from}::timestamptz, ${price.id}::uuid)
          order by effective_from asc, id asc
          limit 1
          for update
        `);
        if (newerCycles.length > 0) {
          throw new AppError(
            'CONFLICT',
            'The price change is superseded by a newer activation cycle',
          );
        }
        const existingBoundary = await transaction.execute<{ id: string }>(sql`
          select id from app.meter_boundaries
          where tenant_id=${context.tenantId} and station_id=${context.stationId}
            and nozzle_id=${payload.nozzleId} and price_change_id=${price.id}
            and reason='PRICE_CHANGE' and reading_status='AVAILABLE'
          limit 1
          for update
        `);
        if (existingBoundary.length > 0) {
          throw new AppError('CONFLICT', 'This nozzle already has a boundary for the price cycle');
        }
      }
      const now = await serverNow(transaction);
      const boundary = confirmBoundary({
        id: payload.boundaryId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: payload.nozzleId,
        meterInstallationId: payload.meterInstallationId,
        businessDayId: payload.businessDayId,
        shiftId: payload.shiftId,
        reason: payload.reason,
        reading:
          payload.readingStatus === 'AVAILABLE'
            ? { status: 'AVAILABLE', value: payload.readingValue ?? '' }
            : { status: 'UNAVAILABLE', reason: payload.unavailableReason ?? '' },
        priorSealedReading: prior[0] ? boundaryFromRow(prior[0]).reading : undefined,
        effectiveAt: now,
        confirmedAt: now,
        actor: context.actor,
        responsibleAttendantId: payload.responsibleAttendantId,
        exceptionReason: payload.exceptionReason,
        priceChangeId: payload.priceChangeId,
      });
      await transaction.execute(sql`
        insert into app.meter_boundaries
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           reason, reading_status, reading_value, unavailable_reason, effective_at, confirmed_at,
           confirmed_by, entered_by, attendant_id, on_behalf_of, exception_reason, price_change_id, version)
        values (${boundary.id}, ${boundary.tenantId}, ${boundary.stationId}, ${boundary.nozzleId},
          ${boundary.meterInstallationId}, ${boundary.businessDayId}, ${boundary.shiftId}, ${boundary.reason},
          ${boundary.reading.status}, ${boundary.reading.status === 'AVAILABLE' ? boundary.reading.value : null},
          ${boundary.reading.status === 'UNAVAILABLE' ? boundary.reading.reason : null},
          ${boundary.effectiveAt}::timestamptz, ${boundary.confirmedAt}::timestamptz,
          ${boundary.confirmedBy}, ${boundary.enteredBy}, ${boundary.attendantId}, ${boundary.onBehalfOf ?? null},
          ${boundary.exceptionReason ?? null}, ${boundary.priceChangeId ?? null}, 0)
      `);
      return {
        result: { boundaryId: boundary.id },
        after: boundary,
        ...(commandType === 'ConfirmPriceChangeBoundary'
          ? {
              event: meterBoundaryCreatedEvent({
                eventId: randomUUID(),
                tenantId: context.tenantId,
                stationId: context.stationId,
                businessDayId: payload.businessDayId,
                shiftId: payload.shiftId,
                boundaryId: boundary.id,
                nozzleId: payload.nozzleId,
                meterInstallationId: payload.meterInstallationId,
                reason: boundary.reason,
                readingStatus: boundary.reading.status,
                ...(boundary.reading.status === 'AVAILABLE'
                  ? { readingValue: boundary.reading.value }
                  : {}),
                priceChangeId: boundary.priceChangeId,
                occurredAt: now,
              }),
            }
          : {}),
      };
    },
  });
}

const resetMeterPayload = z
  .object({
    commandType: z.literal('ResetMeter').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    boundaryId: z.string().uuid(),
    nozzleId: z.string().uuid(),
    meterInstallationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    shiftId: z.string().uuid(),
    responsibleAttendantId: z.string().uuid(),
    readingValue: z.string(),
    reason: z.string().trim().min(1),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function resetMeterFromRequest(request: Request, input: unknown) {
  const payload = resetMeterPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'ResetMeter',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'MeterInstallation',
    subjectId: payload.meterInstallationId,
    expectedVersion: payload.expectedVersion,
    responsibleAttendantId: payload.responsibleAttendantId,
    reason: payload.reason,
    auditMetadata: { nozzleId: payload.nozzleId, boundaryId: payload.boundaryId },
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        installation_id: string;
        meter_id: string;
        nozzle_id: string;
        product_id: string;
        installation_version: number;
        day_state: string;
        shift_state: string;
      }>(sql`
        select i.id as installation_id, i.meter_id, i.nozzle_id, n.product_id,
          i.version as installation_version, d.state as day_state, s.state as shift_state
        from app.meter_installations i
        join app.nozzles n on n.tenant_id=i.tenant_id and n.station_id=i.station_id and n.id=i.nozzle_id
        join app.station_business_days d on d.tenant_id=i.tenant_id and d.station_id=i.station_id and d.id=${payload.businessDayId}
        join app.shifts s on s.tenant_id=d.tenant_id and s.station_id=d.station_id and s.business_day_id=d.id and s.id=${payload.shiftId}
        where i.tenant_id=${context.tenantId} and i.station_id=${context.stationId}
          and i.id=${payload.meterInstallationId} and i.nozzle_id=${payload.nozzleId}
          and n.status='ACTIVE'
        for update of i, d, s
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'The meter installation context was not found');
      if (row.day_state !== 'OPEN' || row.shift_state !== 'OPEN')
        throw new AppError('CONFLICT', 'Meter reset requires an open business day and shift');
      const prior = await transaction.execute<BoundaryRow>(sql`
        select * from app.meter_boundaries
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and nozzle_id=${payload.nozzleId} and meter_installation_id=${payload.meterInstallationId}
          and reading_status='AVAILABLE'
        order by effective_at desc, id desc limit 1 for update
      `);
      const now = await serverNow(transaction);
      const boundary = confirmBoundary({
        id: payload.boundaryId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: payload.nozzleId,
        meterInstallationId: payload.meterInstallationId,
        businessDayId: payload.businessDayId,
        shiftId: payload.shiftId,
        reason: 'METER_RESET',
        reading: { status: 'AVAILABLE', value: payload.readingValue },
        priorSealedReading: prior[0] ? boundaryFromRow(prior[0]).reading : undefined,
        effectiveAt: now,
        confirmedAt: now,
        actor: context.actor,
        responsibleAttendantId: payload.responsibleAttendantId,
        exceptionReason: payload.reason,
      });
      await transaction.execute(sql`
        insert into app.meter_boundaries
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by,
           attendant_id, on_behalf_of, exception_reason, version)
        values (${boundary.id}, ${boundary.tenantId}, ${boundary.stationId}, ${boundary.nozzleId},
          ${boundary.meterInstallationId}, ${boundary.businessDayId}, ${boundary.shiftId}, ${boundary.reason},
          'AVAILABLE', ${payload.readingValue}, ${now}::timestamptz, ${now}::timestamptz,
          ${context.actor.membershipId}, ${context.actor.membershipId}, ${boundary.attendantId},
          ${boundary.onBehalfOf ?? null}, ${payload.reason}, 0)
      `);
      return {
        result: { boundaryId: boundary.id },
        after: boundary,
        event: meterBoundaryCreatedEvent({
          eventId: randomUUID(),
          tenantId: context.tenantId,
          stationId: context.stationId,
          businessDayId: payload.businessDayId,
          shiftId: payload.shiftId,
          boundaryId: boundary.id,
          nozzleId: payload.nozzleId,
          meterInstallationId: payload.meterInstallationId,
          reason: 'METER_RESET',
          readingStatus: 'AVAILABLE',
          readingValue: payload.readingValue,
          occurredAt: now,
        }),
      };
    },
  });
}

const replaceMeterPayload = z
  .object({
    commandType: z.literal('ReplaceMeter').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    oldInstallationId: z.string().uuid(),
    oldMeterId: z.string().uuid(),
    newMeterId: z.string().uuid(),
    nozzleId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    shiftId: z.string().uuid(),
    boundaryId: z.string().uuid(),
    responsibleAttendantId: z.string().uuid(),
    openingReading: z.string(),
    reason: z.string().trim().min(1),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function replaceMeterFromRequest(request: Request, input: unknown) {
  const payload = replaceMeterPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'ReplaceMeter',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'MeterInstallation',
    subjectId: payload.oldInstallationId,
    expectedVersion: payload.expectedVersion,
    reason: payload.reason,
    auditMetadata: {
      nozzleId: payload.nozzleId,
      newMeterId: payload.newMeterId,
      boundaryId: payload.boundaryId,
    },
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        old_id: string;
        old_meter_id: string;
        old_nozzle_id: string;
        old_version: number;
        effective_from: Date | string;
        product_id: string;
        day_state: string;
        shift_state: string;
        new_meter_status: string | null;
      }>(sql`
        select old_i.id as old_id, old_i.meter_id as old_meter_id, old_i.nozzle_id as old_nozzle_id,
          old_i.version as old_version, old_i.effective_from, n.product_id,
          d.state as day_state, s.state as shift_state, new_m.status as new_meter_status
        from app.meter_installations old_i
        join app.nozzles n on n.tenant_id=old_i.tenant_id and n.station_id=old_i.station_id and n.id=old_i.nozzle_id
        join app.station_business_days d on d.tenant_id=old_i.tenant_id and d.station_id=old_i.station_id and d.id=${payload.businessDayId}
        join app.shifts s on s.tenant_id=d.tenant_id and s.station_id=d.station_id and s.business_day_id=d.id and s.id=${payload.shiftId}
        left join app.meters new_m on new_m.tenant_id=old_i.tenant_id and new_m.id=${payload.newMeterId}
        where old_i.tenant_id=${context.tenantId} and old_i.station_id=${context.stationId}
          and old_i.id=${payload.oldInstallationId} and old_i.nozzle_id=${payload.nozzleId}
          and old_i.meter_id=${payload.oldMeterId} and old_i.effective_to is null
          and not exists (
            select 1 from app.meter_installations current_i
            where current_i.tenant_id=old_i.tenant_id and current_i.station_id=old_i.station_id
              and current_i.nozzle_id=old_i.nozzle_id and current_i.effective_to is null
              and current_i.id <> old_i.id
          )
          and n.status='ACTIVE'
        for update of old_i, d, s
      `);
      const row = rows[0];
      if (!row || !row.new_meter_status)
        throw new AppError('NOT_FOUND', 'The replacement meter context was not found');
      if (row.old_meter_id === payload.newMeterId)
        throw new AppError('VALIDATION_FAILED', 'Replacement requires a different meter');
      if (
        row.new_meter_status !== 'ACTIVE' ||
        row.day_state !== 'OPEN' ||
        row.shift_state !== 'OPEN'
      )
        throw new AppError(
          'CONFLICT',
          'Replacement requires an active new meter and open operations',
        );
      const now = await serverNow(transaction);
      const oldInstallation = {
        id: row.old_id,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: payload.nozzleId,
        meterId: row.old_meter_id,
        effectiveFrom: new Date(row.effective_from).toISOString(),
        installedBy: context.actor.membershipId,
        version: Number(row.old_version),
      };
      const ended = replaceMeterInstallation(oldInstallation, now, payload.reason);
      const newInstallationId = randomUUID();
      await transaction.execute(sql`
        update app.meter_installations
        set effective_to=${ended.effectiveTo}::timestamptz, replacement_reason=${payload.reason}, version=version+1
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and id=${payload.oldInstallationId} and version=${payload.expectedVersion}
      `);
      await transaction.execute(sql`
        insert into app.meter_installations
          (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by, replacement_reason, version)
        values (${newInstallationId}, ${context.tenantId}, ${context.stationId}, ${payload.nozzleId},
          ${payload.newMeterId}, ${now}::timestamptz, ${context.actor.membershipId}, ${payload.reason}, 0)
      `);
      const boundary = confirmBoundary({
        id: payload.boundaryId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: payload.nozzleId,
        meterInstallationId: newInstallationId,
        businessDayId: payload.businessDayId,
        shiftId: payload.shiftId,
        reason: 'REPLACEMENT',
        reading: { status: 'AVAILABLE', value: payload.openingReading },
        effectiveAt: now,
        confirmedAt: now,
        actor: context.actor,
        responsibleAttendantId: payload.responsibleAttendantId,
        exceptionReason: payload.reason,
      });
      await transaction.execute(sql`
        insert into app.meter_boundaries
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by,
           attendant_id, on_behalf_of, exception_reason, version)
        values (${boundary.id}, ${context.tenantId}, ${context.stationId}, ${payload.nozzleId}, ${newInstallationId},
          ${payload.businessDayId}, ${payload.shiftId}, 'REPLACEMENT', 'AVAILABLE', ${payload.openingReading},
          ${now}::timestamptz, ${now}::timestamptz, ${context.actor.membershipId}, ${context.actor.membershipId},
          ${boundary.attendantId}, ${boundary.onBehalfOf ?? null}, ${payload.reason}, 0)
      `);
      return {
        result: {
          oldInstallationId: payload.oldInstallationId,
          newInstallationId,
          boundaryId: boundary.id,
        },
        after: {
          oldInstallationId: payload.oldInstallationId,
          newInstallationId,
          boundaryId: boundary.id,
        },
        event: meterReplacedEvent({
          eventId: randomUUID(),
          tenantId: context.tenantId,
          stationId: context.stationId,
          businessDayId: payload.businessDayId,
          shiftId: payload.shiftId,
          oldInstallationId: payload.oldInstallationId,
          newInstallationId,
          oldMeterId: row.old_meter_id,
          newMeterId: payload.newMeterId,
          nozzleId: payload.nozzleId,
          boundaryId: boundary.id,
          occurredAt: now,
        }),
      };
    },
  });
}

const correctMeterSegmentPayload = z
  .object({
    commandType: z.literal('CorrectMeterSegment').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    sourceSegmentId: z.string().uuid(),
    correctedSegmentId: z.string().uuid(),
    responsibleAttendantId: z.string().uuid(),
    correctedClosingReading: z.string(),
    reason: z.string().trim().min(1),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function correctMeterSegmentFromRequest(request: Request, input: unknown) {
  const payload = correctMeterSegmentPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'CorrectMeterSegment',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'MeterSegment',
    subjectId: payload.correctedSegmentId,
    expectedVersionSubjectId: payload.sourceSegmentId,
    expectedVersion: payload.expectedVersion,
    responsibleAttendantId: payload.responsibleAttendantId,
    reason: payload.reason,
    auditMetadata: { sourceSegmentId: payload.sourceSegmentId },
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<
        SegmentDbRow & {
          business_date: string;
          opening_reason: MeterBoundary['reason'];
          closing_reason: MeterBoundary['reason'];
          opening_nozzle_id: string;
          opening_installation_id: string;
          opening_business_day_id: string;
          opening_shift_id: string;
          opening_effective_at: Date | string;
          closing_nozzle_id: string;
          closing_installation_id: string;
          closing_business_day_id: string;
          closing_shift_id: string;
          closing_effective_at: Date | string;
        }
      >(sql`
        select m.*, d.business_date, ob.reason as opening_reason, cb.reason as closing_reason,
          ob.nozzle_id as opening_nozzle_id, ob.meter_installation_id as opening_installation_id,
          ob.business_day_id as opening_business_day_id, ob.shift_id as opening_shift_id,
          ob.effective_at as opening_effective_at,
          cb.nozzle_id as closing_nozzle_id, cb.meter_installation_id as closing_installation_id,
          cb.business_day_id as closing_business_day_id, cb.shift_id as closing_shift_id,
          cb.effective_at as closing_effective_at
        from app.meter_segments m
        join app.station_business_days d on d.tenant_id=m.tenant_id and d.station_id=m.station_id and d.id=m.business_day_id
        join app.meter_boundaries ob on ob.tenant_id=m.tenant_id and ob.station_id=m.station_id and ob.id=m.opening_boundary_id
        join app.meter_boundaries cb on cb.tenant_id=m.tenant_id and cb.station_id=m.station_id and cb.id=m.closing_boundary_id
        where m.tenant_id=${context.tenantId} and m.station_id=${context.stationId}
          and m.id=${payload.sourceSegmentId} and m.state='SEALED'
          and not exists (
            select 1 from app.meter_segments successor
            where successor.tenant_id=m.tenant_id and successor.station_id=m.station_id
              and (successor.correction_of_segment_id=m.id or successor.reversal_of_segment_id=m.id)
          )
        for update of m, ob, cb
      `);
      const source = rows[0];
      if (!source)
        throw new AppError('CONFLICT', 'Only an unsuperseded sealed segment can be corrected');
      if (source.correction_of_segment_id || source.reversal_of_segment_id)
        throw new AppError('CONFLICT', 'A correction must target the original sealed segment');
      const openingAt = Date.parse(String(source.opening_effective_at));
      const closingAt = Date.parse(String(source.closing_effective_at));
      const segmentStartAt = Date.parse(String(source.segment_start_at));
      const segmentEndAt = Date.parse(String(source.segment_end_at));
      if (
        source.opening_nozzle_id !== source.nozzle_id ||
        source.closing_nozzle_id !== source.nozzle_id ||
        source.opening_installation_id !== source.meter_installation_id ||
        source.closing_installation_id !== source.meter_installation_id ||
        source.opening_business_day_id !== source.business_day_id ||
        source.closing_business_day_id !== source.business_day_id ||
        source.opening_shift_id !== source.shift_id ||
        source.closing_shift_id !== source.shift_id ||
        !Number.isFinite(openingAt) ||
        !Number.isFinite(closingAt) ||
        !Number.isFinite(segmentStartAt) ||
        !Number.isFinite(segmentEndAt) ||
        openingAt > closingAt ||
        segmentStartAt > segmentEndAt ||
        openingAt > segmentStartAt ||
        closingAt < segmentEndAt
      ) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'The sealed segment boundary lineage is inconsistent',
        );
      }
      const now = await serverNow(transaction);
      const openingBoundaryId = randomUUID();
      const closingBoundaryId = randomUUID();
      const openingBoundary = confirmBoundary({
        id: openingBoundaryId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: source.nozzle_id,
        meterInstallationId: source.meter_installation_id,
        businessDayId: source.business_day_id,
        shiftId: source.shift_id,
        reason: 'CORRECTION',
        reading: { status: 'AVAILABLE', value: source.opening_reading },
        effectiveAt: new Date(openingAt).toISOString(),
        confirmedAt: now,
        actor: context.actor,
        responsibleAttendantId: payload.responsibleAttendantId,
        exceptionReason: payload.reason,
      });
      const closingBoundary = confirmBoundary({
        id: closingBoundaryId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: source.nozzle_id,
        meterInstallationId: source.meter_installation_id,
        businessDayId: source.business_day_id,
        shiftId: source.shift_id,
        reason: 'CORRECTION',
        reading: { status: 'AVAILABLE', value: payload.correctedClosingReading },
        effectiveAt: new Date(closingAt).toISOString(),
        confirmedAt: now,
        actor: context.actor,
        responsibleAttendantId: payload.responsibleAttendantId,
        exceptionReason: payload.reason,
      });
      await transaction.execute(sql`
        insert into app.meter_boundaries
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by,
           attendant_id, on_behalf_of, exception_reason, version)
        values (${openingBoundary.id}, ${context.tenantId}, ${context.stationId}, ${source.nozzle_id},
          ${source.meter_installation_id}, ${source.business_day_id}, ${source.shift_id}, 'CORRECTION', 'AVAILABLE',
          ${source.opening_reading}, ${openingBoundary.effectiveAt}::timestamptz, ${now}::timestamptz, ${context.actor.membershipId},
          ${context.actor.membershipId}, ${openingBoundary.attendantId}, ${openingBoundary.onBehalfOf ?? null}, ${payload.reason}, 0),
          (${closingBoundary.id}, ${context.tenantId}, ${context.stationId}, ${source.nozzle_id},
          ${source.meter_installation_id}, ${source.business_day_id}, ${source.shift_id}, 'CORRECTION', 'AVAILABLE',
          ${payload.correctedClosingReading}, ${closingBoundary.effectiveAt}::timestamptz, ${now}::timestamptz, ${context.actor.membershipId},
          ${context.actor.membershipId}, ${closingBoundary.attendantId}, ${closingBoundary.onBehalfOf ?? null}, ${payload.reason}, 0)
      `);
      const segment = sealMeterSegment({
        id: payload.correctedSegmentId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        nozzleId: source.nozzle_id,
        meterInstallationId: source.meter_installation_id,
        meterId: source.meter_id,
        businessDayId: source.business_day_id,
        shiftId: source.shift_id,
        openingBoundary: {
          ...openingBoundary,
          reading: { status: 'AVAILABLE', value: source.opening_reading },
        },
        closingBoundary,
        productId: source.product_id,
        attendantId: payload.responsibleAttendantId,
        actor: context.actor,
        unitPrice: source.unit_price,
        sellingPriceId: source.selling_price_id ?? undefined,
        currency: source.currency,
        startAt: timestamp(source.segment_start_at)!,
        endAt: timestamp(source.segment_end_at)!,
        sealedAt: now,
        correctionOfSegmentId: source.id,
      });
      await transaction.execute(sql`
        insert into app.meter_segments
          (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id,
           opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, on_behalf_of,
           correction_of_segment_id, opening_reading, closing_reading, litres, unit_price, selling_price_id,
           expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state, version, controlled_exception)
        values (${segment.id}, ${segment.tenantId}, ${segment.stationId}, ${segment.nozzleId}, ${segment.meterInstallationId},
          ${segment.businessDayId}, ${segment.shiftId}, ${segment.openingBoundaryId}, ${segment.closingBoundaryId}, ${segment.productId},
          ${segment.attendantId}, ${segment.enteredBy}, ${segment.onBehalfOf ?? null}, ${segment.correctionOfSegmentId},
          ${segment.openingReading}, ${segment.closingReading}, ${segment.litres.toString()}, ${segment.unitPrice.toString()},
          ${segment.sellingPriceId ?? null}, ${segment.expectedSaleValue.amount.toString()}, ${segment.currency},
          ${segment.boundaryReason}, ${segment.startAt}::timestamptz, ${segment.endAt}::timestamptz, ${segment.sealedAt}::timestamptz,
          'OPEN', 0, ${segment.controlledException})
      `);
      const sealed = await transaction.execute(sql`
        select app.seal_meter_segment(${context.tenantId}, ${context.stationId}, ${segment.id}, 0) as id
      `);
      if (sealed.length !== 1 || !sealed[0]?.id)
        throw new AppError('CONFLICT', 'The correction could not be sealed');
      return {
        result: { segmentId: segment.id, correctionOfSegmentId: source.id },
        after: { ...segment, version: 1 },
        event: meterSegmentSealedEvent(randomUUID(), segment, {
          legalEntityId: context.legalEntityId,
          businessDate: source.business_date,
          occurredAt: now,
        }),
      };
    },
  });
}

type PriceRow = {
  id: string;
  tenant_id: string;
  station_id: string;
  product_id: string;
  effective_from: Date | string;
  effective_to: Date | string | null;
  unit_price: string;
  currency: 'USD';
  state: SellingPrice['state'];
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | string | null;
  activated_at: Date | string | null;
  version: number | string;
};

function timestamp(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function priceFromRow(row: PriceRow): SellingPrice {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stationId: row.station_id,
    productId: row.product_id,
    effectiveFrom: timestamp(row.effective_from)!,
    ...(timestamp(row.effective_to) ? { effectiveTo: timestamp(row.effective_to) } : {}),
    unitPrice: unitPrice(row.unit_price),
    currency: row.currency,
    state: row.state,
    requestedBy: row.requested_by,
    ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
    ...(timestamp(row.approved_at) ? { approvedAt: timestamp(row.approved_at) } : {}),
    ...(timestamp(row.activated_at) ? { activatedAt: timestamp(row.activated_at) } : {}),
    version: Number(row.version),
  };
}

const priceCommandPayload = z
  .object({
    commandType: z
      .union([z.literal('ApprovePriceChange'), z.literal('ActivatePriceChange')])
      .optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    priceId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

type PriceCommandPayload = z.infer<typeof priceCommandPayload>;

async function priceContext(request: Request, payload: { tenantId: string; stationId: string }) {
  return resolveForecourtCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
    loadStation: loadForecourtStation,
  });
}

const requestPricePayload = z
  .object({
    commandType: z.literal('RequestPriceChange').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    priceId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function requestPriceChangeFromRequest(request: Request, input: unknown) {
  const payload = requestPricePayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'RequestPriceChange',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'SellingPrice',
    subjectId: payload.priceId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<PriceRow>(sql`
        select id, tenant_id, station_id, product_id, effective_from, effective_to,
          unit_price, currency, state, requested_by, approved_by, approved_at, activated_at, version
        from app.selling_prices
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.priceId}
        for update
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Selling price was not found');
      const updated = requestPriceChange(priceFromRow(row));
      await transaction.execute(sql`
        update app.selling_prices set state='PENDING_APPROVAL', version=version+1
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and id=${payload.priceId} and version=${payload.expectedVersion}
      `);
      return { result: { priceId: updated.id }, after: updated };
    },
  });
}

export async function approvePriceChangeFromRequest(request: Request, input: unknown) {
  const payload = priceCommandPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'ApprovePriceChange',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'SellingPrice',
    subjectId: payload.priceId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<PriceRow>(sql`
        select id, tenant_id, station_id, product_id, effective_from, effective_to,
               unit_price, currency, state, requested_by, approved_by, approved_at,
               activated_at, version
        from app.selling_prices
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.priceId}
        for update
      `);
      const price = rows[0];
      if (!price) throw new AppError('NOT_FOUND', 'Selling price was not found');
      const updated = approvePriceChange(
        priceFromRow(price),
        context.actor,
        await serverNow(transaction),
      );
      await transaction.execute(sql`
        update app.selling_prices
        set state = 'APPROVED', approved_by = ${updated.approvedBy}, approved_at = ${updated.approvedAt}::timestamptz,
            version = version + 1
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.priceId}
          and version = ${payload.expectedVersion}
      `);
      return { result: { priceId: updated.id }, after: updated };
    },
  });
}

export async function activatePriceChangeFromRequest(request: Request, input: unknown) {
  const payload = priceCommandPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'ActivatePriceChange',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'SellingPrice',
    subjectId: payload.priceId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const rows = await transaction.execute<PriceRow>(sql`
        select id, tenant_id, station_id, product_id, effective_from, effective_to,
               unit_price, currency, state, requested_by, approved_by, approved_at,
               activated_at, version
        from app.selling_prices
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.priceId}
        for update
      `);
      const price = rows[0];
      if (!price) throw new AppError('NOT_FOUND', 'Selling price was not found');
      const now = await serverNow(transaction);
      const boundaries = await loadPriceActivationBoundaries(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        productId: price.product_id,
        priceId: price.id,
      });
      if (
        price.state !== 'PENDING_STATION_ACTIVATION' &&
        price.state !== 'BOUNDARIES_IN_PROGRESS'
      ) {
        throw new AppError('CONFLICT', `ActivatePriceChange is not allowed from ${price.state}`);
      }
      if (boundaries.length === 0 || boundaries.some((boundary) => boundary.state !== 'SEALED')) {
        throw new AppError('CONFLICT', 'All affected persisted meter boundaries must be complete');
      }
      const requiresBoundaryPhase = price.state === 'PENDING_STATION_ACTIVATION';
      if (requiresBoundaryPhase) {
        await transaction.execute(sql`
          update app.selling_prices
          set state = 'BOUNDARIES_IN_PROGRESS', version = version + 1
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.priceId}
            and version = ${payload.expectedVersion}
        `);
      }
      const updated: SellingPrice = {
        ...priceFromRow(price),
        state: 'ACTIVE',
        activatedAt: now,
        version: Number(price.version) + (requiresBoundaryPhase ? 2 : 1),
      };
      await transaction.execute(sql`
        update app.selling_prices
        set state = 'ACTIVE', activated_at = ${now}::timestamptz, version = version + 1
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.priceId}
          and version = ${payload.expectedVersion + (requiresBoundaryPhase ? 1 : 0)}
      `);
      return {
        result: { priceId: updated.id },
        event: priceBoundaryActivatedEvent({
          eventId: randomUUID(),
          tenantId: updated.tenantId,
          stationId: updated.stationId,
          priceId: updated.id,
          productId: updated.productId,
          effectiveFrom: updated.effectiveFrom,
          unitPrice: updated.unitPrice.toString(),
          currency: updated.currency,
        }),
        after: updated,
      };
    },
  });
}

const declarationPayload = z.object({
  id: z.string().uuid().optional(),
  category: z.enum([
    'CASH',
    'ELECTRONIC',
    'CUSTOMER_ACCOUNT',
    'PREPAID',
    'BENEFIT_INTERNAL',
    'OTHER',
  ]),
  amount: z.string(),
  reason: z.string().optional(),
});

const submitReconciliationPayload = z
  .object({
    commandType: z.literal('SubmitReconciliation').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    revisionId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    declarations: z.array(declarationPayload),
    responsibleAttendantId: z.string().uuid().optional(),
    explanation: z.string().optional(),
  })
  .strict();

type SegmentDbRow = {
  id: string;
  tenant_id: string;
  station_id: string;
  nozzle_id: string;
  meter_installation_id: string;
  meter_id: string;
  business_day_id: string;
  business_date: string;
  shift_id: string;
  opening_boundary_id: string;
  closing_boundary_id: string;
  product_id: string;
  attendant_id: string;
  entered_by: string;
  on_behalf_of: string | null;
  opening_reading: string;
  closing_reading: string;
  litres: string;
  unit_price: string;
  expected_sale_value: string;
  currency: 'USD';
  boundary_reason: MeterBoundary['reason'];
  segment_start_at: Date | string;
  segment_end_at: Date | string;
  sealed_at: Date | string;
  controlled_exception: boolean;
  correction_of_segment_id: string | null;
  reversal_of_segment_id: string | null;
  selling_price_id: string | null;
};

function segmentFromRow(row: SegmentDbRow): MeterSegment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stationId: row.station_id,
    nozzleId: row.nozzle_id,
    meterInstallationId: row.meter_installation_id,
    meterId: row.meter_id,
    businessDayId: row.business_day_id,
    businessDate: row.business_date as never,
    shiftId: row.shift_id,
    openingBoundaryId: row.opening_boundary_id,
    closingBoundaryId: row.closing_boundary_id,
    productId: row.product_id,
    attendantId: row.attendant_id,
    enteredBy: row.entered_by,
    ...(row.on_behalf_of ? { onBehalfOf: row.on_behalf_of } : {}),
    openingReading: row.opening_reading,
    closingReading: row.closing_reading,
    litres: litres(row.litres),
    unitPrice: unitPrice(row.unit_price),
    currency: row.currency,
    expectedSaleValue: money(row.expected_sale_value, row.currency),
    openingBoundaryReason: 'SHIFT_OPEN',
    boundaryReason: row.boundary_reason,
    startAt: timestamp(row.segment_start_at)!,
    endAt: timestamp(row.segment_end_at)!,
    sealedAt: timestamp(row.sealed_at)!,
    controlledException: row.controlled_exception,
    ...(row.correction_of_segment_id
      ? { correctionOfSegmentId: row.correction_of_segment_id }
      : {}),
    ...(row.reversal_of_segment_id ? { reversalOfSegmentId: row.reversal_of_segment_id } : {}),
    ...(row.selling_price_id ? { sellingPriceId: row.selling_price_id } : {}),
    version: 1,
  };
}

export async function submitReconciliationFromRequest(request: Request, input: unknown) {
  const payload = submitReconciliationPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'SubmitReconciliation',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'ReconciliationRevision',
    subjectId: payload.revisionId,
    expectedVersion: payload.expectedVersion,
    responsibleAttendantId: payload.responsibleAttendantId,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const row = await loadRevision(transaction, context, payload.revisionId);
      const segments = await transaction.execute<SegmentDbRow>(sql`
        select m.*, d.business_date from app.meter_segments m
        join app.station_business_days d on d.tenant_id=m.tenant_id and d.station_id=m.station_id and d.id=m.business_day_id
        where m.tenant_id=${context.tenantId} and m.station_id=${context.stationId}
          and m.business_day_id=${row.business_day_id} and m.state='SEALED'
          and not exists (
            select 1 from app.meter_segments successor
            where successor.tenant_id=m.tenant_id and successor.station_id=m.station_id
              and (successor.correction_of_segment_id=m.id or successor.reversal_of_segment_id=m.id)
          )
        order by m.id for share
      `);
      const computed = calculateReconciliation({
        id: row.id,
        reconciliationId: row.reconciliation_id,
        revision: Number(row.revision),
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: row.business_day_id,
        businessDate: row.business_date,
        segments: segments.map(segmentFromRow),
        declarations: payload.declarations.map((declaration) => ({
          id: declaration.id ?? randomUUID(),
          category: declaration.category,
          amount: money(declaration.amount, 'USD'),
          declaredBy: context.actor.membershipId,
          ...(payload.responsibleAttendantId
            ? { declaredFor: payload.responsibleAttendantId }
            : {}),
          ...(declaration.reason ? { reason: declaration.reason } : {}),
        })),
        policy: { warningThreshold: '1.00', blockingThreshold: '5.00' },
        sourceRevisionId: row.source_revision_id ?? undefined,
        correctionOfRevisionId: row.correction_of_revision_id ?? undefined,
        sourceShiftIds: [...new Set(segments.map((segment) => segment.shift_id))],
      });
      const submitted = submitReconciliation(computed, context.actor, payload.explanation);
      const now = await serverNow(transaction);
      await transaction.execute(sql`
        update app.reconciliation_revisions set state='SUBMITTED', expected_sales=${submitted.expectedSales.amount.toString()},
          accounted_sales=${submitted.accountedSales.amount.toString()}, variance=${submitted.variance.amount.toString()},
          variance_classification=${submitted.varianceClassification}, variance_explanation=${submitted.varianceExplanation ?? null},
          declarations=${JSON.stringify(submitted.declarations)}::jsonb, source_segment_ids=${JSON.stringify(submitted.sourceSegmentIds)}::jsonb,
          source_shift_ids=${JSON.stringify(submitted.sourceShiftIds)}::jsonb, submitted_by=${submitted.submittedBy}, submitted_at=${now}::timestamptz,
          version=version+1
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.revisionId} and version=${payload.expectedVersion}
      `);
      return { result: { revisionId: submitted.id }, after: submitted };
    },
  });
}

const returnReconciliationPayload = z
  .object({
    commandType: z.literal('ReturnReconciliation').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    revisionId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1),
  })
  .strict();

export async function returnReconciliationFromRequest(request: Request, input: unknown) {
  const payload = returnReconciliationPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'ReturnReconciliation',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'ReconciliationRevision',
    subjectId: payload.revisionId,
    expectedVersion: payload.expectedVersion,
    reason: payload.reason,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const row = await loadRevision(transaction, context, payload.revisionId);
      const returned = returnReconciliation(revisionFromRow(row), payload.reason);
      await transaction.execute(sql`
        update app.reconciliation_revisions set state='RETURNED', variance_explanation=${returned.varianceExplanation}, version=version+1
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.revisionId} and version=${payload.expectedVersion}
      `);
      return { result: { revisionId: returned.id }, after: returned };
    },
  });
}

const correctedRevisionPayload = z
  .object({
    commandType: z.literal('CreateCorrectedReconciliationRevision').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    sourceRevisionId: z.string().uuid(),
    revisionId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(1),
  })
  .strict();

export async function createCorrectedReconciliationRevisionFromRequest(
  request: Request,
  input: unknown,
) {
  const payload = correctedRevisionPayload.parse(input);
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'CreateCorrectedReconciliationRevision',
    idempotencyKey: key,
    requestHash: genericRequestHash(payload),
    subjectType: 'ReconciliationRevision',
    subjectId: payload.revisionId,
    expectedVersionSubjectId: payload.sourceRevisionId,
    expectedVersion: payload.expectedVersion,
    reason: payload.reason,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const source = await loadRevision(transaction, context, payload.sourceRevisionId);
      if (source.state !== 'RETURNED')
        throw new AppError('CONFLICT', 'Only a returned revision can be corrected');
      const parent = await transaction.execute<{
        id: string;
        current_revision_id: string | null;
      }>(sql`
        select c.id,
          (select r.id from app.reconciliation_revisions r
           where r.tenant_id = c.tenant_id and r.station_id = c.station_id
             and r.reconciliation_id = c.id
           order by r.revision desc limit 1) as current_revision_id
        from app.reconciliations c
        where c.tenant_id = ${context.tenantId}
          and c.station_id = ${context.stationId}
          and c.id = ${source.reconciliation_id}
        for update
      `);
      if (!parent[0] || parent[0].current_revision_id !== source.id) {
        throw new AppError('CONFLICT', 'The returned revision is no longer the current revision');
      }
      const next = await transaction.execute<{ revision: number }>(sql`
        select coalesce(max(revision), 0) + 1 as revision
        from app.reconciliation_revisions
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and reconciliation_id = ${source.reconciliation_id}
      `);
      await transaction.execute(sql`
        insert into app.reconciliation_revisions
          (id, tenant_id, station_id, reconciliation_id, revision, state, expected_sales, accounted_sales, variance,
           currency, variance_classification, variance_explanation, declarations, source_segment_ids, source_shift_ids,
           source_revision_id, correction_of_revision_id, version)
        values (${payload.revisionId}, ${context.tenantId}, ${context.stationId}, ${source.reconciliation_id}, ${Number(next[0]!.revision)}, 'READY',
          ${source.expected_sales}, ${source.accounted_sales}, ${source.variance}, ${source.currency}, ${source.variance_classification},
          ${payload.reason}, ${JSON.stringify(source.declarations)}::jsonb, ${JSON.stringify(source.source_segment_ids)}::jsonb,
          ${JSON.stringify(source.source_shift_ids)}::jsonb, ${source.id}, ${source.id}, 0)
      `);
      const now = await serverNow(transaction);
      return {
        result: { revisionId: payload.revisionId, revision: Number(next[0]!.revision) },
        after: { revision: Number(next[0]!.revision), sourceRevisionId: source.id },
        event: reconciliationRevisionCorrectedEvent({
          eventId: randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          stationId: context.stationId,
          businessDate: source.business_date,
          reconciliationId: source.reconciliation_id,
          revisionId: payload.revisionId,
          revision: Number(next[0]!.revision),
          sourceRevisionId: source.id,
          correctionOfRevisionId: source.id,
          state: 'READY',
          occurredAt: now,
        }),
      };
    },
  });
}

const reconciliationCommandPayload = z
  .object({
    commandType: z
      .union([
        z.literal('ApproveReconciliation'),
        z.literal('PostReconciliation'),
        z.literal('LockReconciliation'),
      ])
      .optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    revisionId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

type ReconciliationRow = {
  id: string;
  reconciliation_id: string;
  revision: number;
  tenant_id: string;
  station_id: string;
  business_day_id: string;
  business_date: string;
  state: ReconciliationRevision['state'];
  expected_sales: string;
  accounted_sales: string;
  variance: string;
  currency: 'USD';
  variance_classification: ReconciliationRevision['varianceClassification'];
  variance_explanation: string | null;
  declarations: unknown;
  source_segment_ids: unknown;
  source_shift_ids: unknown;
  source_revision_id: string | null;
  correction_of_revision_id: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  posted_by: string | null;
  posted_at: Date | string | null;
  locked_by: string | null;
  locked_at: Date | string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function declarations(value: unknown, currency: 'USD') {
  if (!Array.isArray(value))
    throw new AppError('VALIDATION_FAILED', 'Declarations must be an array');
  return value.map((item) => {
    if (!item || typeof item !== 'object')
      throw new AppError('VALIDATION_FAILED', 'Invalid declaration snapshot');
    const row = item as Record<string, unknown>;
    const category = row.category;
    const declaredBy = row.declaredBy;
    const amount = row.amount;
    if (
      typeof category !== 'string' ||
      typeof declaredBy !== 'string' ||
      typeof amount !== 'string'
    ) {
      throw new AppError('VALIDATION_FAILED', 'Invalid declaration snapshot');
    }
    return {
      id: typeof row.id === 'string' ? row.id : `${category}:${declaredBy}`,
      category: category as ReconciliationPaymentCategory,
      amount: money(amount, currency),
      declaredBy,
      ...(typeof row.declaredFor === 'string' ? { declaredFor: row.declaredFor } : {}),
      ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    };
  });
}

function revisionFromRow(row: ReconciliationRow): ReconciliationRevision {
  return {
    id: row.id,
    reconciliationId: row.reconciliation_id,
    revision: Number(row.revision),
    tenantId: row.tenant_id,
    stationId: row.station_id,
    businessDayId: row.business_day_id,
    state: row.state,
    expectedSales: money(row.expected_sales, row.currency),
    declarations: declarations(row.declarations, row.currency),
    accountedSales: money(row.accounted_sales, row.currency),
    variance: money(row.variance, row.currency),
    varianceClassification: row.variance_classification,
    ...(row.variance_explanation ? { varianceExplanation: row.variance_explanation } : {}),
    ...(row.submitted_by ? { submittedBy: row.submitted_by } : {}),
    ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
    ...(timestamp(row.approved_at) ? { approvedAt: timestamp(row.approved_at) } : {}),
    ...(row.posted_by ? { postedBy: row.posted_by } : {}),
    ...(row.posted_at ? { postedAt: timestamp(row.posted_at) } : {}),
    ...(row.locked_by ? { lockedBy: row.locked_by } : {}),
    ...(row.locked_at ? { lockedAt: timestamp(row.locked_at) } : {}),
    sourceSegmentIds: stringArray(row.source_segment_ids),
    sourceShiftIds: stringArray(row.source_shift_ids),
    ...(row.source_revision_id ? { sourceRevisionId: row.source_revision_id } : {}),
    ...(row.correction_of_revision_id
      ? { correctionOfRevisionId: row.correction_of_revision_id }
      : {}),
  };
}

async function loadRevision(
  transaction: Parameters<Parameters<import('../../platform/db').Database['transaction']>[0]>[0],
  context: Awaited<ReturnType<typeof priceContext>>,
  revisionId: string,
) {
  const rows = await transaction.execute<ReconciliationRow>(sql`
    select r.id, r.reconciliation_id, r.revision, r.tenant_id, r.station_id, c.business_day_id,
           d.business_date, r.state, r.expected_sales, r.accounted_sales, r.variance, r.currency,
           r.variance_classification, r.variance_explanation, r.declarations, r.source_segment_ids,
           r.source_shift_ids, r.source_revision_id, r.correction_of_revision_id, r.submitted_by,
           r.approved_by, r.approved_at, r.posted_by, r.posted_at, r.locked_by, r.locked_at
    from app.reconciliation_revisions r
    join app.reconciliations c on c.tenant_id = r.tenant_id and c.station_id = r.station_id and c.id = r.reconciliation_id
    join app.station_business_days d on d.tenant_id = c.tenant_id and d.station_id = c.station_id and d.id = c.business_day_id
    where r.tenant_id = ${context.tenantId} and r.station_id = ${context.stationId} and r.id = ${revisionId}
    for update of r, c, d
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Reconciliation revision was not found');
  return row;
}

export async function approveReconciliationFromRequest(request: Request, input: unknown) {
  const payload = reconciliationCommandPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'ApproveReconciliation',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'ReconciliationRevision',
    subjectId: payload.revisionId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const row = await loadRevision(transaction, context, payload.revisionId);
      const now = await serverNow(transaction);
      const revision = approveReconciliation(revisionFromRow(row), context.actor, now);
      await transaction.execute(sql`
        update app.reconciliation_revisions
        set state = 'APPROVED', approved_by = ${revision.approvedBy}, approved_at = ${revision.approvedAt}::timestamptz, version = version + 1
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.revisionId} and version = ${payload.expectedVersion}
      `);
      return {
        result: { revisionId: revision.id },
        event: reconciliationApprovedEvent(randomUUID(), revision, {
          legalEntityId: context.legalEntityId,
          businessDate: row.business_date,
          occurredAt: now,
        }),
        after: revision,
      };
    },
  });
}

export async function postReconciliationFromRequest(request: Request, input: unknown) {
  const payload = reconciliationCommandPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'PostReconciliation',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'ReconciliationRevision',
    subjectId: payload.revisionId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const row = await loadRevision(transaction, context, payload.revisionId);
      const now = await serverNow(transaction);
      const revision = postReconciliation(revisionFromRow(row), context.actor, now);
      await transaction.execute(sql`
        update app.reconciliation_revisions
        set state = 'POSTED', posted_by = ${revision.postedBy}, posted_at = ${revision.postedAt}::timestamptz, version = version + 1
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.revisionId} and version = ${payload.expectedVersion}
      `);
      return {
        result: { revisionId: revision.id },
        event: reconciliationPostedEvent(randomUUID(), revision, {
          legalEntityId: context.legalEntityId,
          businessDate: row.business_date,
          occurredAt: now,
        }),
        after: revision,
      };
    },
  });
}

export async function lockReconciliationFromRequest(request: Request, input: unknown) {
  const payload = reconciliationCommandPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'LockReconciliation',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'ReconciliationRevision',
    subjectId: payload.revisionId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    execute: async (transaction) => {
      const row = await loadRevision(transaction, context, payload.revisionId);
      const revision = lockReconciliation(
        revisionFromRow(row),
        context.actor,
        await serverNow(transaction),
      );
      await transaction.execute(sql`
        update app.reconciliation_revisions
        set state = 'LOCKED', locked_by = ${revision.lockedBy}, locked_at = ${revision.lockedAt}::timestamptz, version = version + 1
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.revisionId} and version = ${payload.expectedVersion}
      `);
      return { result: { revisionId: revision.id }, after: revision };
    },
  });
}

const businessDayLockPayload = z
  .object({
    commandType: z.literal('LockBusinessDay').optional(),
    tenantId: z.string().uuid(),
    stationId: z.string().uuid(),
    businessDayId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export async function lockBusinessDayFromRequest(request: Request, input: unknown) {
  const payload = businessDayLockPayload.parse(input);
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  const context = await priceContext(request, payload);
  return executeForecourtCommand({
    context,
    commandType: 'LockBusinessDay',
    idempotencyKey,
    requestHash: genericRequestHash(payload),
    subjectType: 'StationBusinessDay',
    subjectId: payload.businessDayId,
    expectedVersion: payload.expectedVersion,
    ports: databaseForecourtPorts(),
    auditMetadata: { businessDayId: payload.businessDayId },
    execute: async (transaction) => {
      const rows = await transaction.execute<{
        id: string;
        business_date: string;
        state: string;
        version: number;
      }>(sql`
        select id, business_date, state, version
        from app.station_business_days
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.businessDayId}
        for update
      `);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Business day was not found');
      const unfinished = await transaction.execute<{ count: number }>(sql`
        select count(*)::int as count from app.shifts
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and business_day_id=${payload.businessDayId}
          and state not in ('COMPLETED','NOT_OPERATED','CANCELLED_BEFORE_START')
      `);
      if (Number(unfinished[0]?.count ?? 0) > 0)
        throw new AppError(
          'CONFLICT',
          'Every planned shift must be completed or explicitly NOT_OPERATED',
        );
      const openSegments = await transaction.execute<{ count: number }>(sql`
        select count(*)::int as count from app.meter_segments
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and business_day_id=${payload.businessDayId} and state <> 'SEALED'
      `);
      if (Number(openSegments[0]?.count ?? 0) > 0)
        throw new AppError(
          'CONFLICT',
          'All operational meter segments must be sealed before locking',
        );
      const unavailable = await transaction.execute<{ count: number }>(sql`
        select count(*)::int as count from app.meter_boundaries unavailable_boundary
        where unavailable_boundary.tenant_id=${context.tenantId} and unavailable_boundary.station_id=${context.stationId}
          and unavailable_boundary.business_day_id=${payload.businessDayId} and unavailable_boundary.reading_status='UNAVAILABLE'
          and not exists (
            select 1 from app.meter_boundaries resolved
            where resolved.tenant_id=unavailable_boundary.tenant_id and resolved.station_id=unavailable_boundary.station_id
              and resolved.nozzle_id=unavailable_boundary.nozzle_id
              and resolved.effective_at > unavailable_boundary.effective_at
              and resolved.reading_status='AVAILABLE'
          )
      `);
      if (Number(unavailable[0]?.count ?? 0) > 0)
        throw new AppError(
          'CONFLICT',
          'An unresolved unavailable meter blocks business-day locking',
        );
      const posted = await transaction.execute<{
        state: string;
        variance_classification: string;
      }>(sql`
        select r.state, r.variance_classification
        from app.reconciliation_revisions r
        join app.reconciliations c on c.tenant_id=r.tenant_id and c.station_id=r.station_id and c.id=r.reconciliation_id
        where r.tenant_id=${context.tenantId} and r.station_id=${context.stationId}
          and c.business_day_id=${payload.businessDayId}
        order by r.revision desc limit 1 for update of r, c
      `);
      if (posted.length !== 1 || !['POSTED', 'LOCKED'].includes(posted[0]!.state))
        throw new AppError(
          'CONFLICT',
          'The exact authoritative reconciliation revision must be POSTED before locking',
        );
      if (posted[0]!.variance_classification === 'BLOCKING')
        throw new AppError(
          'CONFLICT',
          'A blocking reconciliation variance prevents business-day locking',
        );
      const day = lockBusinessDay({
        id: row.id,
        tenantId: context.tenantId,
        stationId: context.stationId,
        date: row.business_date as never,
        state: row.state as 'CLOSED',
        version: Number(row.version),
      });
      const now = await serverNow(transaction);
      await transaction.execute(sql`
        update app.station_business_days set state = 'LOCKED', version = version + 1, updated_at = ${now}::timestamptz
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId} and id = ${payload.businessDayId}
          and version = ${payload.expectedVersion}
      `);
      return {
        result: { businessDayId: day.id },
        event: businessDayLockedEvent({
          eventId: randomUUID(),
          tenantId: context.tenantId,
          stationId: context.stationId,
          businessDayId: day.id,
          businessDate: row.business_date,
          lockedAt: now,
          legalEntityId: context.legalEntityId,
          occurredAt: now,
        }),
        after: day,
      };
    },
  });
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
    effectiveAt: timestamp(row.effective_at)!,
    confirmedAt: timestamp(row.confirmed_at)!,
    confirmedBy: row.confirmed_by,
    enteredBy: row.entered_by,
    attendantId: row.attendant_id,
    ...(row.on_behalf_of ? { onBehalfOf: row.on_behalf_of } : {}),
    ...(row.exception_reason ? { exceptionReason: row.exception_reason } : {}),
    ...(row.price_change_id ? { priceChangeId: row.price_change_id } : {}),
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
    subjectId: payload.segmentId,
    responsibleAttendantId: payload.responsibleAttendantId,
    auditMetadata: {
      meterInstallationId: payload.meterInstallationId,
      nozzleId: payload.nozzleId,
      businessDayId: payload.businessDayId,
      shiftId: payload.shiftId,
    },
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
        planned_start_at: Date | string;
        planned_end_at: Date | string;
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
          s.planned_start_at, s.planned_end_at,
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
          and n.status = 'ACTIVE'
          and m.status = 'ACTIVE'
          and i.effective_from <= ${payload.startAt}::timestamptz
          and (i.effective_to is null or i.effective_to > ${payload.endAt}::timestamptz)
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
      if (
        Date.parse(payload.startAt) < Date.parse(String(row.planned_start_at)) ||
        Date.parse(payload.endAt) > Date.parse(String(row.planned_end_at))
      ) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Meter segment times must belong to the authoritative shift interval',
        );
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
      const latestBoundary = await transaction.execute<{ id: string }>(sql`
        select id from app.meter_boundaries
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and nozzle_id=${payload.nozzleId} and meter_installation_id=${payload.meterInstallationId}
          and business_day_id=${payload.businessDayId} and shift_id=${payload.shiftId}
          and reading_status='AVAILABLE'
          and effective_at <= ${opening.effective_at}::timestamptz
        order by effective_at desc, id desc limit 1
        for update
      `);
      if (latestBoundary[0] && latestBoundary[0].id !== opening.id)
        throw new AppError(
          'CONFLICT',
          'The segment opening boundary is stale; use the latest sealed boundary',
        );

      const activePrice = await transaction.execute<{
        id: string;
        unit_price: string;
        currency: 'USD';
      }>(
        sql`
        select id, unit_price, currency
        from app.selling_prices
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and product_id = ${payload.productId}
          and state = 'ACTIVE'
          and effective_from <= ${payload.startAt}::timestamptz
          and (effective_to is null or effective_to >= ${payload.endAt}::timestamptz)
        order by effective_from desc
        limit 1
        for update
      `,
      );
      const price = activePrice[0];
      if (!price)
        throw new AppError('CONFLICT', 'No active selling price covers the meter segment');

      const sealTimestamp = await serverNow(transaction);
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
        sellingPriceId: price.id,
        currency: price.currency,
        startAt: payload.startAt,
        endAt: payload.endAt,
        sealedAt: sealTimestamp,
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
        sellingPriceId: segment.sellingPriceId,
        expectedSaleValue: segment.expectedSaleValue.amount.toString(),
        currency: segment.currency,
        boundaryReason: segment.boundaryReason,
        segmentStartAt: new Date(segment.startAt),
        segmentEndAt: new Date(segment.endAt),
        sealedAt: new Date(segment.sealedAt),
        state: 'OPEN',
        version: 0,
      };
      await transaction.insert(meterSegments).values(insertValues).onConflictDoNothing({
        target: meterSegments.id,
      });
      const sealed = await transaction.execute(sql`
        select app.seal_meter_segment(
          ${context.tenantId},
          ${context.stationId},
          ${payload.segmentId},
          ${payload.expectedVersion}
        ) as id
      `);
      if (sealed.length !== 1 || !sealed[0]?.id) {
        throw new AppError('CONFLICT', 'The meter segment could not be sealed exactly once');
      }
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
          occurredAt: sealTimestamp,
        }),
        after: { ...segment, version: 1 },
      };
    },
  });
}
