import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { type Database } from '../../platform/db';
import { databaseForecourtTransactionPort } from './application';
import {
  forecourtAuditEvents,
  forecourtIdempotencyRecords,
  forecourtOutbox,
} from '../../platform/db/schema/a3';
import type {
  ForecourtAuditPort,
  ForecourtCommandPorts,
  ForecourtOutboxPort,
  ForecourtTransaction,
  IdempotencyRequest,
  IdempotencyPort,
} from './application';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function dbTransaction(transaction: ForecourtTransaction): DatabaseTransaction {
  return transaction as DatabaseTransaction;
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
    await tx.insert(forecourtAuditEvents).values({
      tenantId: input.provenance.tenantId,
      stationId: input.provenance.stationId,
      actorId: input.provenance.actorId,
      membershipId: input.provenance.membershipId,
      commandType: input.commandType,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      requestId: input.provenance.requestId,
      ...(input.provenance.responsibleAttendantId
        ? { responsibleAttendantId: input.provenance.responsibleAttendantId }
        : {}),
      ...(input.before !== undefined ? { beforeSnapshot: jsonRoundTrip(input.before) } : {}),
      ...(input.after !== undefined ? { afterSnapshot: jsonRoundTrip(input.after) } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
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
};

async function assertAttendantEligibility(
  transaction: ForecourtTransaction,
  attendantId: string,
  stationId: string,
  tenantId: string,
): Promise<void> {
  const tx = dbTransaction(transaction);
  const rows = await tx.execute(sql`
    SELECT 1
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
  subjectType: string,
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
  const rows = await tx.execute(sql`
    SELECT version FROM ${qualifiedTable}
    WHERE tenant_id = ${tenantId} AND station_id = ${stationId} AND id = ${subjectId}
    FOR UPDATE
  `);
  const row = rows[0] as { version: number | string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', `${subjectType} was not found in this station`);
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
