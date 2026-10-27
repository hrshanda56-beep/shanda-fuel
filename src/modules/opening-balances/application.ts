import 'server-only';

import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';

export type OpeningBalanceTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type OpeningBalanceCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  requestId: string;
  scope: { tenantId: string; scopeType: 'TENANT' };
}>;

export async function resolveOpeningBalanceCommandContext(input: {
  request: Request;
  requestedTenantId: string;
}): Promise<OpeningBalanceCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: undefined,
    stationId: undefined,
  });
  return {
    authority: { ...authority, transaction },
    tenantId: authority.membership.tenantId,
    requestId: transaction.requestId ?? randomUUID(),
    scope: { tenantId: authority.membership.tenantId, scopeType: 'TENANT' },
  };
}

export function authorizeOpeningBalanceCommand(
  context: OpeningBalanceCommandContext,
  permissionCode: PermissionCode = 'finance.opening_balance.manage',
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function runIdempotent<T>(
  transaction: OpeningBalanceTransaction,
  input: { tenantId: string; commandType: string; idempotencyKey: string; requestHash: string },
  effect: () => Promise<T>,
): Promise<T> {
  const commandType = `OpeningBalance.${input.commandType}`;
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
    if (!row) throw new AppError('CONFLICT', 'The opening balance command disappeared');
    if (row.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    }
    if (row.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'The opening balance command is already in progress');
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

export async function executeOpeningBalanceCommand<T>(input: {
  context: OpeningBalanceCommandContext;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
  audit: {
    actionCode: string;
    subjectId: string | ((result: unknown) => string);
    before?: unknown;
    after?: unknown;
  };
  execute: (transaction: OpeningBalanceTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  authorizeOpeningBalanceCommand(input.context);
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
            actionCode: input.audit.actionCode,
            subjectType: 'OpeningBalanceBatch',
            subjectId:
              typeof input.audit.subjectId === 'function'
                ? input.audit.subjectId(result)
                : input.audit.subjectId,
            requestId: input.context.requestId,
            occurredAt: new Date().toISOString(),
            before: input.audit.before,
            after: input.audit.after ?? result,
          },
          getAuditSigningKey(),
          transaction,
        );
        return result;
      },
    ),
  );
}
