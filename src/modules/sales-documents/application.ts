import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { authorize, type AccessScope } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';
import { SALES_DOCUMENT_COMMAND_POLICY, type SalesDocumentCommandType } from './contracts';

export type SalesDocumentTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Documents belong to a company (legal entity), never to a single station. */
export type SalesDocumentContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  requestId: string;
  scope: AccessScope;
}>;

export function salesDocumentRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function bindSalesDocumentScope(input: {
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
}): Promise<SalesDocumentContext> {
  const { authority } = input;
  if (authority.membership.tenantId !== input.tenantId) {
    throw new AppError('FORBIDDEN', 'The request is outside the trusted tenant context');
  }
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{ id: string }>(sql`
      select id from app.legal_entities
      where tenant_id = ${input.tenantId} and id = ${input.legalEntityId} and status = 'ACTIVE'
      limit 1
    `),
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The requested company was not found');
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: input.legalEntityId,
  });
  return {
    authority: { ...authority, transaction },
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    requestId: transaction.requestId ?? randomUUID(),
    scope: {
      tenantId: input.tenantId,
      scopeType: 'LEGAL_ENTITY',
      legalEntityId: input.legalEntityId,
    },
  };
}

export async function resolveSalesDocumentCommandContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId: string;
}): Promise<SalesDocumentContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.tenantId,
  });
  return bindSalesDocumentScope({
    authority,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
}

async function runIdempotent<T>(
  transaction: SalesDocumentTransaction,
  input: { tenantId: string; commandType: string; idempotencyKey: string; requestHash: string },
  effect: () => Promise<T>,
): Promise<T> {
  const commandType = `SalesDocument.${input.commandType}`;
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
    if (!row) throw new AppError('CONFLICT', 'The idempotency record disappeared');
    if (row.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    }
    if (row.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'The command is already in progress');
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

export async function executeSalesDocumentCommand<T>(input: {
  context: SalesDocumentContext;
  commandType: SalesDocumentCommandType;
  idempotencyKey: string;
  requestHash: string;
  audit: {
    subjectType: string;
    subjectId: string | ((result: T) => string);
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  execute: (transaction: SalesDocumentTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  const policy = SALES_DOCUMENT_COMMAND_POLICY[input.commandType];
  // authorize() applies the platform step-up gate to high-risk codes such as sales_document.void.
  authorize({
    actor: input.context.authority.authorization,
    permissionCode: policy.permissionCode,
    requestedScope: input.context.scope,
  });
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
