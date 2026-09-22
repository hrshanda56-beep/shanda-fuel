import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { type Database } from '../../platform/db';
import { getServerEnv } from '../../platform/config/env';
import { securityEvents } from '../../platform/db/schema/a1';
import { databaseForecourtTransactionPort } from './application';
import { forecourtIdempotencyRecords, forecourtOutbox } from '../../platform/db/schema/a3';
import { signAuditEvent } from '../audit/contracts';
import { withTenantTransaction } from '../../platform/db/transaction';
import type { TenantExecutionContext } from '../tenancy/authority';
import type {
  ForecourtAuditPort,
  ForecourtCommandPorts,
  ForecourtOutboxPort,
  ForecourtTransaction,
  ForecourtVersionSubject,
  IdempotencyRequest,
  IdempotencyPort,
} from './application';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Load activation boundaries only inside the caller's trusted transaction. */
export async function loadPriceActivationBoundaries(
  transaction: ForecourtTransaction,
  input: { tenantId: string; stationId: string; productId: string; priceId: string },
): Promise<readonly { id: string; state: 'SEALED' | 'OPEN' }[]> {
  const tx = dbTransaction(transaction);
  return tx.execute<{ id: string; state: 'SEALED' | 'OPEN' }>(sql`
    select n.id,
      case when exists (
        select 1 from app.meter_boundaries b
        where b.tenant_id = n.tenant_id
          and b.station_id = n.station_id
          and b.nozzle_id = n.id
          and b.reason = 'PRICE_CHANGE'
          and b.price_change_id = ${input.priceId}
          and b.reading_status = 'AVAILABLE'
          and not exists (
            select 1 from app.meter_boundaries newer
            where newer.tenant_id = b.tenant_id
              and newer.station_id = b.station_id
              and newer.nozzle_id = b.nozzle_id
              and newer.reason = 'PRICE_CHANGE'
              and newer.price_change_id = b.price_change_id
              and (newer.effective_at, newer.id) > (b.effective_at, b.id)
          )
      ) then 'SEALED' else 'OPEN' end as state
    from app.nozzles n
    where n.tenant_id = ${input.tenantId}
      and n.station_id = ${input.stationId}
      and n.product_id = ${input.productId}
      and n.status = 'ACTIVE'
    for update
  `);
}

function dbTransaction(transaction: ForecourtTransaction): DatabaseTransaction {
  return transaction;
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

/**
 * Durable idempotency is deliberately inside the caller's transaction. The
 * unique key serializes concurrent retries and the request hash prevents a
 * key from being reused for a different command payload.
 */
export const databaseIdempotencyPort: IdempotencyPort = {
  async run<T>(
    transaction: ForecourtTransaction,
    request: IdempotencyRequest,
    effect: () => Promise<T>,
  ) {
    const tx = dbTransaction(transaction);
    const inserted = await tx
      .insert(forecourtIdempotencyRecords)
      .values({
        tenantId: request.tenantId,
        commandType: request.commandType,
        idempotencyKey: request.idempotencyKey,
        requestHash: request.requestHash,
        status: 'IN_PROGRESS',
        resultPayload: {},
      })
      .onConflictDoNothing({
        target: [
          forecourtIdempotencyRecords.tenantId,
          forecourtIdempotencyRecords.commandType,
          forecourtIdempotencyRecords.idempotencyKey,
        ],
      })
      .returning({ id: forecourtIdempotencyRecords.id });

    if (inserted.length === 0) {
      const existing = await tx
        .select({
          requestHash: forecourtIdempotencyRecords.requestHash,
          status: forecourtIdempotencyRecords.status,
          resultPayload: forecourtIdempotencyRecords.resultPayload,
        })
        .from(forecourtIdempotencyRecords)
        .where(
          and(
            eq(forecourtIdempotencyRecords.tenantId, request.tenantId),
            eq(forecourtIdempotencyRecords.commandType, request.commandType),
            eq(forecourtIdempotencyRecords.idempotencyKey, request.idempotencyKey),
          ),
        )
        .for('update');
      const row = existing[0];
      if (!row) throw new AppError('CONFLICT', 'The idempotency record disappeared during retry');
      if (row.requestHash !== request.requestHash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was reused with a new request',
        );
      }
      if (row.status !== 'COMPLETED') {
        throw new AppError('CONFLICT', 'The idempotency record is still in progress');
      }
      return (row.resultPayload as { value: T }).value;
    }

    const result = await effect();
    await tx
      .update(forecourtIdempotencyRecords)
      .set({
        status: 'COMPLETED',
        resultPayload: { value: jsonRoundTrip(result) },
        completedAt: new Date(),
      })
      .where(eq(forecourtIdempotencyRecords.id, inserted[0]!.id));
    return result;
  },
};

export const databaseAuditPort: ForecourtAuditPort = {
  async append(input) {
    const tx = dbTransaction(input.transaction);
    const env = getServerEnv();
    if (!env.AUDIT_SIGNING_KEY_ID || !env.AUDIT_SIGNING_KEY) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Audit signing credentials are not configured');
    }
    const event = signAuditEvent(
      {
        eventId: randomUUID(),
        tenantId: input.provenance.tenantId,
        membershipId: input.provenance.membershipId,
        actorId: input.provenance.actorId,
        actorType: 'HUMAN',
        actionCode: `FORECOURT.${input.commandType}`,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        requestId: input.provenance.requestId || randomUUID(),
        occurredAt: new Date().toISOString(),
        before: input.before,
        after: input.after,
        reason: input.reason,
        metadata: {
          stationId: input.provenance.stationId,
          responsibleAttendantId: input.provenance.responsibleAttendantId ?? null,
          onBehalfOf:
            input.provenance.responsibleAttendantId &&
            input.provenance.responsibleAttendantId !== input.provenance.membershipId
              ? {
                  membershipId: input.provenance.responsibleAttendantId,
                  actorType: 'HUMAN',
                }
              : null,
          ...input.auditMetadata,
        },
      },
      { keyId: env.AUDIT_SIGNING_KEY_ID, secret: env.AUDIT_SIGNING_KEY },
    );
    await tx.insert(securityEvents).values({
      id: event.eventId,
      tenantId: event.tenantId,
      membershipId: event.membershipId,
      actorId: event.actorId,
      eventCode: event.eventCode,
      requestId: event.requestId,
      occurredAt: new Date(event.occurredAt),
      details: event.details,
      keyId: event.keyId,
      algorithm: event.algorithm,
      signature: event.signature,
    });
  },
};

export const databaseOutboxPort: ForecourtOutboxPort = {
  async publish(input) {
    const tx = dbTransaction(input.transaction);
    const event = input.event;
    const aggregate =
      'segmentId' in event
        ? { aggregateType: 'MeterSegment', aggregateId: event.segmentId }
        : 'reconciliationId' in event
          ? { aggregateType: 'Reconciliation', aggregateId: event.reconciliationId }
          : 'priceId' in event
            ? { aggregateType: 'SellingPrice', aggregateId: event.priceId }
            : { aggregateType: 'StationBusinessDay', aggregateId: event.businessDayId };
    await tx
      .insert(forecourtOutbox)
      .values({
        eventId: event.eventId,
        tenantId: event.tenantId,
        stationId: event.stationId,
        eventType: event.eventType,
        eventVersion: 'eventVersion' in event ? event.eventVersion : 1,
        ...aggregate,
        payload: jsonRoundTrip(event),
      })
      .onConflictDoNothing({ target: forecourtOutbox.eventId });
  },
};

const versionedSubjectTables: Record<string, string> = {
  StationBusinessDay: 'station_business_days',
  Shift: 'shifts',
  Reconciliation: 'reconciliations',
  ReconciliationRevision: 'reconciliation_revisions',
  MeterBoundary: 'meter_boundaries',
  MeterSegment: 'meter_segments',
  MeterInstallation: 'meter_installations',
  SellingPrice: 'selling_prices',
};

async function assertAttendantEligibility(
  transaction: ForecourtTransaction,
  attendantId: string,
  stationId: string,
  tenantId: string,
): Promise<void> {
  const tx = dbTransaction(transaction);
  const rows = await tx.execute<{ eligible: number }>(sql`
    SELECT 1 AS eligible
    FROM app.memberships AS membership
    JOIN app.membership_role_assignments AS assignment
      ON assignment.tenant_id = membership.tenant_id
     AND assignment.membership_id = membership.id
    WHERE membership.tenant_id = ${tenantId}
      AND membership.id = ${attendantId}
      AND membership.status = 'ACTIVE'
      AND assignment.scope_type = 'STATION'
      AND assignment.station_id = ${stationId}
      AND assignment.role_code = 'ATTENDANT'
      AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
    FOR SHARE
  `);
  if (rows.length === 0) {
    throw new AppError('FORBIDDEN', 'The responsible attendant is not eligible for this station');
  }
}

async function assertExpectedVersion(
  transaction: ForecourtTransaction,
  subjectType: ForecourtVersionSubject,
  subjectId: string,
  expectedVersion: number,
  stationId: string,
  tenantId: string,
): Promise<void> {
  const tableName = versionedSubjectTables[subjectType];
  if (!tableName) {
    throw new AppError('VALIDATION_FAILED', `No versioned forecourt subject: ${subjectType}`);
  }
  const qualifiedTable = sql.raw(`"app"."${tableName}"`);
  const tx = dbTransaction(transaction);
  const rows = await tx.execute<{ version: number | string }>(sql`
    SELECT version FROM ${qualifiedTable}
    WHERE tenant_id = ${tenantId} AND station_id = ${stationId} AND id = ${subjectId}
    FOR UPDATE
  `);
  const row = rows[0];
  if (!row) {
    if (
      (subjectType === 'MeterSegment' ||
        subjectType === 'StationBusinessDay' ||
        subjectType === 'Shift' ||
        subjectType === 'Reconciliation') &&
      expectedVersion === 0
    )
      return;
    throw new AppError('NOT_FOUND', `${subjectType} was not found in this station`);
  }
  if (Number(row.version) !== expectedVersion) {
    throw new AppError('CONFLICT', 'The forecourt subject version is stale', {
      expectedVersion,
      actualVersion: Number(row.version),
    });
  }
}

export function databaseForecourtPorts(): ForecourtCommandPorts {
  return {
    transaction: databaseForecourtTransactionPort,
    idempotency: databaseIdempotencyPort,
    attendantEligibility: assertAttendantEligibility,
    expectedVersion: assertExpectedVersion,
    audit: databaseAuditPort,
    outbox: databaseOutboxPort,
  };
}

/** Load the station under the same trusted A1 tenant context used by commands. */
export async function loadForecourtStation(
  authority: TenantExecutionContext,
  stationId: string,
): Promise<{ id: string; tenantId: string; legalEntityId: string } | null> {
  return withTenantTransaction(authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{ id: string; tenantId: string; legalEntityId: string }>(
      sql`
      select id, tenant_id as "tenantId", legal_entity_id as "legalEntityId"
      from app.stations
      where tenant_id = ${authority.membership.tenantId} and id = ${stationId}
      limit 1
      `,
    );
    return rows[0] ?? null;
  });
}
