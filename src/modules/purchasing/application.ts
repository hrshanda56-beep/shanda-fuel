import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import {
  authorize,
  type AccessScope,
  type PermissionCode,
} from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';
import { PURCHASING_COMMAND_POLICY, type PurchasingCommandType } from './contracts';

export type PurchasingTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type PurchasingCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  requestId: string;
  scope: AccessScope;
}>;

export function purchasingRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

type StationRow = { id: string; legal_entity_id: string; status: string };

/**
 * Resolve the trusted execution context. A station is always validated against the tenant, and
 * the legal entity is derived from it, so a caller can never mix a station with another entity.
 */
export async function bindPurchasingScope(input: {
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId?: string;
  stationId: string;
}): Promise<PurchasingCommandContext> {
  const { authority } = input;
  if (authority.membership.tenantId !== input.tenantId) {
    throw new AppError('FORBIDDEN', 'The request is outside the trusted tenant context');
  }
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<StationRow>(sql`
      select id, legal_entity_id, status
      from app.stations
      where tenant_id = ${input.tenantId} and id = ${input.stationId}
      limit 1
    `),
  );
  const station = rows[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
  if (station.status === 'ARCHIVED') {
    throw new AppError('INVARIANT_VIOLATION', 'Archived stations cannot take purchasing commands');
  }
  if (input.legalEntityId && station.legal_entity_id !== input.legalEntityId) {
    throw new AppError('FORBIDDEN', 'The station does not belong to the requested legal entity');
  }
  const legalEntityId = station.legal_entity_id;
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId,
    stationId: input.stationId,
  });
  const scope: AccessScope = {
    tenantId: input.tenantId,
    scopeType: 'STATION',
    legalEntityId,
    stationId: input.stationId,
  };
  return {
    authority: { ...authority, transaction },
    tenantId: input.tenantId,
    legalEntityId,
    stationId: input.stationId,
    requestId: transaction.requestId ?? randomUUID(),
    scope,
  };
}

export async function resolvePurchasingCommandContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId?: string;
  stationId: string;
}): Promise<PurchasingCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.tenantId,
  });
  return bindPurchasingScope({
    authority,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
  });
}

export function authorizePurchasingCommand(
  context: PurchasingCommandContext,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

async function runIdempotent<T>(
  transaction: PurchasingTransaction,
  input: { tenantId: string; commandType: string; idempotencyKey: string; requestHash: string },
  effect: () => Promise<T>,
): Promise<T> {
  const commandType = `Purchasing.${input.commandType}`;
  const inserted = await transaction
    .insert(forecourtIdempotencyRecords)
    .values({
      tenantId: input.tenantId,
      commandType,
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
          eq(forecourtIdempotencyRecords.commandType, commandType),
          eq(forecourtIdempotencyRecords.idempotencyKey, input.idempotencyKey),
        ),
      )
      .for('update');
    const row = existing[0];
    if (!row) throw new AppError('CONFLICT', 'The purchasing idempotency record disappeared');
    if (row.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    }
    if (row.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'The purchasing command is already in progress');
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

export async function executePurchasingCommand<T>(input: {
  context: PurchasingCommandContext;
  commandType: PurchasingCommandType;
  idempotencyKey: string;
  requestHash: string;
  audit: {
    subjectType: string;
    subjectId: string | ((result: T) => string);
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  execute: (transaction: PurchasingTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  const policy = PURCHASING_COMMAND_POLICY[input.commandType];
  authorizePurchasingCommand(input.context, policy.permissionCode);
  return withTenantTransaction(input.context.authority.transaction, async (transaction) =>
    runIdempotent(
      transaction,
      {
        tenantId: input.context.tenantId,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      async () => {
        const result = await input.execute(transaction);
        await appendSecurityEvent(
          {
            eventId: randomUUID(),
            tenantId: input.context.tenantId,
            membershipId: input.context.authority.membership.membershipId,
            actorId: input.context.authority.actor.identityId,
            actorType: 'HUMAN',
            actionCode: policy.auditActionCode,
            subjectType: input.audit.subjectType,
            subjectId:
              typeof input.audit.subjectId === 'function'
                ? input.audit.subjectId(result)
                : input.audit.subjectId,
            requestId: input.context.requestId,
            occurredAt: new Date().toISOString(),
            after: result,
            reason: input.audit.reason,
            metadata: {
              legalEntityId: input.context.legalEntityId,
              stationId: input.context.stationId,
              ...(input.audit.metadata ?? {}),
            },
          },
          getAuditSigningKey(),
          transaction,
        );
        return result;
      },
    ),
  );
}
