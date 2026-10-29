import type { AuthenticatedActorContext } from '../identity';
import { markReadTiming } from '../../platform/observability/read-timing';
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { appendSecurityEvent } from '../audit/contracts';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { resolveStationReadAuthority } from '../context/read-authority';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';

export type InventoryTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type InventoryCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  stationTimezone: string;
  requestId: string;
  scope: {
    tenantId: string;
    scopeType: 'STATION';
    legalEntityId: string;
    stationId: string;
  };
}>;

export async function resolveInventoryCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId: string;
}): Promise<InventoryCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });
  return withTenantTransaction(authority.transaction, (transaction) =>
    inventoryContextInTransaction(authority, input.stationId, transaction),
  );
}

async function inventoryContextInTransaction(
  authority: TenantExecutionContext,
  stationId: string,
  databaseTransaction: InventoryTransaction,
): Promise<InventoryCommandContext> {
  const stationRows = await databaseTransaction.execute<{
    id: string;
    tenant_id: string;
    legal_entity_id: string;
    timezone: string;
  }>(sql`
      select id, tenant_id, legal_entity_id, timezone
      from app.stations
      where tenant_id = ${authority.membership.tenantId} and id = ${stationId}
      limit 1
    `);
  const station = stationRows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
  if (station.tenant_id !== authority.membership.tenantId) {
    throw new AppError('FORBIDDEN', 'The station is outside the trusted tenant context');
  }
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: station.legal_entity_id,
    stationId: station.id,
  });
  return {
    authority: { ...authority, transaction },
    tenantId: station.tenant_id,
    legalEntityId: station.legal_entity_id,
    stationId: station.id,
    stationTimezone: station.timezone,
    requestId: transaction.requestId ?? randomUUID(),
    scope: {
      tenantId: station.tenant_id,
      scopeType: 'STATION',
      legalEntityId: station.legal_entity_id,
      stationId: station.id,
    },
  };
}

/** Authorize the station and read its data without opening a second transaction. */
export async function withInventoryReadContext<T>(
  request: Request,
  tenantId: string,
  stationId: string,
  work: (transaction: InventoryTransaction, context: InventoryCommandContext) => Promise<T>,
  authenticatedActor?: AuthenticatedActorContext,
): Promise<T> {
  const { authority, station } = await resolveStationReadAuthority({
    request,
    tenantId,
    stationId,
    ...(authenticatedActor ? { authenticatedActor } : {}),
  });
  markReadTiming('inventory.authority.ready');
  const transactionContext = station?.timezone
    ? createTrustedTenantTransactionContext({
        ...authority.transaction,
        legalEntityId: station.legalEntityId,
        stationId: station.id,
      })
    : authority.transaction;
  return withTenantTransaction(transactionContext, async (transaction) => {
    markReadTiming('inventory.transaction.context.ready');
    const context: InventoryCommandContext = station?.timezone
      ? {
          authority: { ...authority, transaction: transactionContext },
          tenantId,
          legalEntityId: station.legalEntityId,
          stationId: station.id,
          stationTimezone: station.timezone,
          requestId: transactionContext.requestId ?? randomUUID(),
          scope: {
            tenantId,
            scopeType: 'STATION',
            legalEntityId: station.legalEntityId,
            stationId: station.id,
          },
        }
      : await inventoryContextInTransaction(authority, stationId, transaction);
    markReadTiming('inventory.station.loaded');
    authorizeInventoryCommand(context, 'inventory.view');
    if (!station?.timezone)
      await transaction.execute(sql`
      select set_config('app.legal_entity_id', ${context.legalEntityId}, true),
             set_config('app.station_id', ${context.stationId}, true)
    `);
    markReadTiming('inventory.station.context.ready');
    const result = await work(transaction, context);
    markReadTiming('inventory.data.loaded');
    return result;
  });
}

export function authorizeInventoryCommand(
  context: InventoryCommandContext,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

export function requestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

type InventoryAudit = Readonly<{
  actionCode: string;
  subjectType: string;
  subjectId: string | ((result: unknown) => string);
  before?: unknown;
  /** Reads what the subject looked like before this command changes it. */
  readBefore?: (transaction: InventoryTransaction) => Promise<unknown>;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}>;

async function runIdempotent<T>(
  transaction: InventoryTransaction,
  input: {
    tenantId: string;
    commandType: string;
    idempotencyKey: string;
    requestHash: string;
  },
  effect: () => Promise<T>,
): Promise<T> {
  const inserted = await transaction
    .insert(forecourtIdempotencyRecords)
    .values({
      tenantId: input.tenantId,
      commandType: `Inventory.${input.commandType}`,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
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
    const existing = await transaction
      .select({
        requestHash: forecourtIdempotencyRecords.requestHash,
        status: forecourtIdempotencyRecords.status,
        resultPayload: forecourtIdempotencyRecords.resultPayload,
      })
      .from(forecourtIdempotencyRecords)
      .where(
        and(
          eq(forecourtIdempotencyRecords.tenantId, input.tenantId),
          eq(forecourtIdempotencyRecords.commandType, `Inventory.${input.commandType}`),
          eq(forecourtIdempotencyRecords.idempotencyKey, input.idempotencyKey),
        ),
      )
      .for('update');
    const row = existing[0];
    if (!row) throw new AppError('CONFLICT', 'The inventory idempotency record disappeared');
    if (row.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    }
    if (row.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'The inventory command is already in progress');
    }
    return (row.resultPayload as { value: T }).value;
  }
  const result = await effect();
  await transaction
    .update(forecourtIdempotencyRecords)
    .set({
      status: 'COMPLETED',
      resultPayload: { value: JSON.parse(JSON.stringify(result)) },
      completedAt: new Date(),
    })
    .where(eq(forecourtIdempotencyRecords.id, inserted[0]!.id));
  return result;
}

export async function executeInventoryCommand<T>(input: {
  context: InventoryCommandContext;
  commandType: string;
  permissionCode: PermissionCode;
  idempotencyKey: string;
  requestHash: string;
  audit: InventoryAudit;
  execute: (transaction: InventoryTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  authorizeInventoryCommand(input.context, input.permissionCode);
  return withTenantTransaction(input.context.authority.transaction, async (transaction) => {
    return runIdempotent(
      transaction,
      {
        tenantId: input.context.tenantId,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      async () => {
        const before = input.audit.readBefore
          ? await input.audit.readBefore(transaction)
          : input.audit.before;
        const result = await input.execute(transaction);
        const auditKey = getAuditSigningKey();
        await appendSecurityEvent(
          {
            eventId: randomUUID(),
            tenantId: input.context.tenantId,
            membershipId: input.context.authority.membership.membershipId,
            actorId: input.context.authority.actor.identityId,
            actorType: 'HUMAN',
            actionCode: input.audit.actionCode,
            subjectType: input.audit.subjectType,
            subjectId:
              typeof input.audit.subjectId === 'function'
                ? input.audit.subjectId(result)
                : input.audit.subjectId,
            requestId: input.context.requestId,
            occurredAt: new Date().toISOString(),
            before,
            after: result ?? input.audit.after,
            reason: input.audit.reason,
            metadata: {
              stationId: input.context.stationId,
              ...(input.audit.metadata ?? {}),
            },
          },
          auditKey,
          transaction,
        );
        return result;
      },
    );
  });
}

export type InventoryTransactionRunner = <T>(
  context: InventoryCommandContext,
  work: (transaction: InventoryTransaction) => Promise<T>,
) => Promise<T>;

export const databaseInventoryTransaction: InventoryTransactionRunner = (context, work) =>
  withTenantTransaction(context.authority.transaction, work);
