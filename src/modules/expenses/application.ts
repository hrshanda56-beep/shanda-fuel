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

export const EXPENSE_PERMISSION_CODES = [
  'expense.view',
  'expense.submit',
  'expense.approve',
  'expense.post',
  'expense.reverse',
  'expense.recurring.manage',
] as const;
export type ExpensePermissionCode = (typeof EXPENSE_PERMISSION_CODES)[number];

export const EXPENSE_COMMAND_TYPES = [
  'SubmitExpense',
  'ReturnExpense',
  'ApproveExpense',
  'RejectExpense',
  'PostExpense',
  'ReverseExpense',
  'CreateRecurringExpenseTemplate',
  'UpdateRecurringExpenseTemplate',
  'DeactivateRecurringExpenseTemplate',
  'GenerateRecurringCostPeriod',
] as const;
export type ExpenseCommandType = (typeof EXPENSE_COMMAND_TYPES)[number];

export type ExpenseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ExpenseCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  stationId?: string;
  requestId: string;
  scope: AccessScope;
}>;

export async function resolveExpenseCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  legalEntityId?: string;
  stationId?: string;
}): Promise<ExpenseCommandContext> {
  if (!input.legalEntityId && !input.stationId) {
    throw new AppError(
      'VALIDATION_FAILED',
      'An authorised legal-entity or station context is required',
    );
  }

  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });

  let legalEntityId = input.legalEntityId;
  let stationId = input.stationId;

  if (stationId) {
    const rows = await withTenantTransaction(authority.transaction, (transaction) =>
      transaction.execute<{
        id: string;
        tenant_id: string;
        legal_entity_id: string;
      }>(sql`
        select id, tenant_id, legal_entity_id
        from app.stations
        where tenant_id = ${input.requestedTenantId}
          and id = ${stationId}
          and status = 'ACTIVE'
        limit 1
      `),
    );
    const station = rows[0];
    if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
    if (station.tenant_id !== authority.membership.tenantId) {
      throw new AppError('FORBIDDEN', 'The station is outside the trusted tenant context');
    }
    if (legalEntityId && legalEntityId !== station.legal_entity_id) {
      throw new AppError('FORBIDDEN', 'The station is outside the requested legal entity');
    }
    legalEntityId = station.legal_entity_id;
  } else if (legalEntityId) {
    const rows = await withTenantTransaction(authority.transaction, (transaction) =>
      transaction.execute<{ id: string; tenant_id: string }>(sql`
        select id, tenant_id
        from app.legal_entities
        where tenant_id = ${input.requestedTenantId}
          and id = ${legalEntityId}
          and status = 'ACTIVE'
        limit 1
      `),
    );
    const entity = rows[0];
    if (!entity) throw new AppError('NOT_FOUND', 'The requested legal entity was not found');
    if (entity.tenant_id !== authority.membership.tenantId) {
      throw new AppError('FORBIDDEN', 'The legal entity is outside the trusted tenant context');
    }
  }

  if (!legalEntityId) {
    throw new AppError('INVARIANT_VIOLATION', 'Expense context could not resolve a legal entity');
  }

  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId,
    ...(stationId ? { stationId } : {}),
  });
  const scope: AccessScope = stationId
    ? {
        tenantId: authority.membership.tenantId,
        scopeType: 'STATION',
        legalEntityId,
        stationId,
      }
    : { tenantId: authority.membership.tenantId, scopeType: 'LEGAL_ENTITY', legalEntityId };

  return {
    authority: { ...authority, transaction },
    tenantId: authority.membership.tenantId,
    legalEntityId,
    ...(stationId ? { stationId } : {}),
    requestId: transaction.requestId ?? randomUUID(),
    scope,
  };
}

export function authorizeExpenseCommand(
  context: ExpenseCommandContext,
  permissionCode: ExpensePermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

export function expenseRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export const requestHash = expenseRequestHash;

async function runIdempotent<T>(
  transaction: ExpenseTransaction,
  input: {
    tenantId: string;
    commandType: ExpenseCommandType;
    idempotencyKey: string;
    requestHash: string;
  },
  effect: () => Promise<T>,
): Promise<T> {
  const commandType = `Expense.${input.commandType}`;
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
    if (!row) throw new AppError('CONFLICT', 'The expense idempotency record disappeared');
    if (row.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    }
    if (row.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'The expense command is already in progress');
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

export async function executeExpenseCommand<T>(input: {
  context: ExpenseCommandContext;
  commandType: ExpenseCommandType;
  permissionCode: ExpensePermissionCode;
  idempotencyKey: string;
  requestHash: string;
  audit: {
    actionCode: string;
    subjectType: string;
    subjectId: string | ((result: unknown) => string);
    before?: unknown;
    after?: unknown;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  execute: (transaction: ExpenseTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  authorizeExpenseCommand(input.context, input.permissionCode);

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
            subjectType: input.audit.subjectType,
            subjectId:
              typeof input.audit.subjectId === 'function'
                ? input.audit.subjectId(result)
                : input.audit.subjectId,
            requestId: input.context.requestId,
            occurredAt: new Date().toISOString(),
            before: input.audit.before,
            after: result ?? input.audit.after,
            reason: input.audit.reason,
            metadata: {
              legalEntityId: input.context.legalEntityId,
              ...(input.context.stationId ? { stationId: input.context.stationId } : {}),
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
