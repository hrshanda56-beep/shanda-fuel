import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { authorize, type AccessScope } from '../../platform/security/permissions';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';

export type LiabilityTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type LiabilityCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
  requestId: string;
  scope: AccessScope;
}>;

export function liabilityRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function resolveLiabilityCommandContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
}): Promise<LiabilityCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.tenantId,
  });
  if (authority.membership.tenantId !== input.tenantId) {
    throw new AppError('FORBIDDEN', 'The request is outside the trusted tenant context');
  }
  let stationLegalEntityId: string | undefined;
  if (input.stationId) {
    const rows = await withTenantTransaction(authority.transaction, (transaction) =>
      transaction.execute<{ id: string; legal_entity_id: string }>(sql`
        select id, legal_entity_id from app.stations
        where tenant_id = ${input.tenantId} and id = ${input.stationId} and status <> 'RETIRED'
        limit 1
      `),
    );
    const station = rows[0];
    if (!station) throw new AppError('NOT_FOUND', 'The requested finance scope was not found');
    stationLegalEntityId = station.legal_entity_id;
  } else {
    const rows = await withTenantTransaction(authority.transaction, (transaction) =>
      transaction.execute<{ id: string }>(sql`
        select id from app.legal_entities
        where tenant_id = ${input.tenantId} and id = ${input.legalEntityId} and status = 'ACTIVE'
        limit 1
      `),
    );
    if (!rows[0]) throw new AppError('NOT_FOUND', 'The requested finance scope was not found');
  }
  if (stationLegalEntityId && stationLegalEntityId !== input.legalEntityId) {
    throw new AppError('FORBIDDEN', 'The station does not belong to the requested company');
  }
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: input.legalEntityId,
    ...(input.stationId ? { stationId: input.stationId } : {}),
  });
  return {
    authority: { ...authority, transaction },
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    ...(input.stationId ? { stationId: input.stationId } : {}),
    requestId: transaction.requestId ?? randomUUID(),
    scope: input.stationId
      ? {
          tenantId: input.tenantId,
          scopeType: 'STATION',
          legalEntityId: input.legalEntityId,
          stationId: input.stationId,
        }
      : { tenantId: input.tenantId, scopeType: 'LEGAL_ENTITY', legalEntityId: input.legalEntityId },
  };
}

export async function resolveLiabilityReadContext(request: Request, tenantId: string) {
  return resolveTenantExecutionContext({ request, requestedTenantId: tenantId });
}

export function authorizeLiabilityCommand(context: LiabilityCommandContext): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'finance.liability.manage',
    requestedScope: context.scope,
  });
}

export function authorizeLiabilityRead(
  authority: TenantExecutionContext,
  tenantId: string,
  legalEntityId?: string,
  stationId?: string,
): void {
  authorize({
    actor: authority.authorization,
    permissionCode: 'report.view',
    requestedScope: stationId
      ? { tenantId, scopeType: 'STATION', legalEntityId, stationId }
      : legalEntityId
        ? { tenantId, scopeType: 'LEGAL_ENTITY', legalEntityId }
        : { tenantId, scopeType: 'TENANT' },
  });
}

async function runIdempotent<T>(
  transaction: LiabilityTransaction,
  input: { tenantId: string; commandType: string; idempotencyKey: string; requestHash: string },
  effect: () => Promise<T>,
): Promise<T> {
  const commandType = `Liability.${input.commandType}`;
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
    if (!row) throw new AppError('CONFLICT', 'The liability command disappeared');
    if (row.requestHash !== input.requestHash)
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    if (row.status !== 'COMPLETED')
      throw new AppError('CONFLICT', 'The liability command is already in progress');
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

export async function executeLiabilityCommand<T>(input: {
  context: LiabilityCommandContext;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
  actionCode: string;
  subjectId: (result: T) => string;
  reason?: string;
  execute: (transaction: LiabilityTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim())
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  authorizeLiabilityCommand(input.context);
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
            actionCode: input.actionCode,
            subjectType: 'ApprovedLiability',
            subjectId: input.subjectId(result),
            requestId: input.context.requestId,
            occurredAt: new Date().toISOString(),
            reason: input.reason,
            after: result,
          },
          getAuditSigningKey(),
          transaction,
        );
        return result;
      },
    ),
  );
}
