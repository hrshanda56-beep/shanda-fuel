import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { meterSegments } from '../../platform/db/schema/a3';
import { money, unitPrice } from '../../platform/domain/primitives';
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
} from './contracts';
import {
  approvePriceChange,
  approveReconciliation,
  lockReconciliation,
  lockBusinessDay,
  postReconciliation,
  sealMeterSegment,
  type MeterBoundary,
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

function genericRequestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
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
    select r.id, r.reconciliation_id, r.revision, r.tenant_id, r.station_id, r.business_day_id,
           d.business_date, r.state, r.expected_sales, r.accounted_sales, r.variance, r.currency,
           r.variance_classification, r.variance_explanation, r.declarations, r.source_segment_ids,
           r.source_shift_ids, r.source_revision_id, r.correction_of_revision_id, r.submitted_by,
           r.approved_by, r.approved_at, r.posted_by, r.posted_at, r.locked_by, r.locked_at
    from app.reconciliation_revisions r
    join app.reconciliations c on c.tenant_id = r.tenant_id and c.station_id = r.station_id and c.id = r.reconciliation_id
    join app.station_business_days d on d.tenant_id = r.tenant_id and d.station_id = r.station_id and d.id = r.business_day_id
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
      const startBusinessDate = new Date(payload.startAt).toISOString().slice(0, 10);
      const endBusinessDate = new Date(payload.endAt).toISOString().slice(0, 10);
      if (startBusinessDate !== row.business_date || endBusinessDate !== row.business_date) {
        throw new AppError(
          'INVARIANT_VIOLATION',
          'Meter segment times must belong to the business day',
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
        currency: price.currency,
        startAt: payload.startAt,
        endAt: payload.endAt,
        sealedAt: sealTimestamp,
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
        state: 'OPEN',
        version: 0,
      };
      await transaction.insert(meterSegments).values(insertValues);
      const sealed = await transaction.execute(sql`
        update app.meter_segments
        set state = 'SEALED', version = version + 1
        where tenant_id = ${context.tenantId}
          and station_id = ${context.stationId}
          and id = ${payload.segmentId}
          and state = 'OPEN'
          and version = 0
        returning id
      `);
      if (sealed.length !== 1) {
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
