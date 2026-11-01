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
  isPermissionGranted,
  type AccessScope,
  type PermissionCode,
} from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';
import { EXPENSE_COMMAND_POLICY, type ExpenseCommandType } from './contracts';

export type ExpenseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ExpenseCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  /** Present for every station-scoped command; absent for legal-entity master data. */
  stationId?: string;
  requestId: string;
  scope: AccessScope;
}>;

export function expenseRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

type StationRow = { id: string; legal_entity_id: string; status: string };

/**
 * Resolve the trusted execution context. A station is always validated against the tenant, and
 * the legal entity is derived from it, so a caller can never mix a station with another entity.
 */
export async function bindExpenseScope(input: {
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId?: string;
  stationId?: string;
}): Promise<ExpenseCommandContext> {
  const { authority } = input;
  if (authority.membership.tenantId !== input.tenantId) {
    throw new AppError('FORBIDDEN', 'The request is outside the trusted tenant context');
  }
  let legalEntityId = input.legalEntityId;
  if (input.stationId) {
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
      throw new AppError('INVARIANT_VIOLATION', 'Archived stations cannot take expense commands');
    }
    if (legalEntityId && station.legal_entity_id !== legalEntityId) {
      throw new AppError('FORBIDDEN', 'The station does not belong to the requested legal entity');
    }
    legalEntityId = station.legal_entity_id;
  } else if (legalEntityId) {
    const rows = await withTenantTransaction(authority.transaction, (transaction) =>
      transaction.execute<{ id: string }>(sql`
        select id from app.legal_entities
        where tenant_id = ${input.tenantId} and id = ${legalEntityId} and status = 'ACTIVE'
        limit 1
      `),
    );
    if (!rows[0]) throw new AppError('NOT_FOUND', 'The requested legal entity was not found');
  }
  if (!legalEntityId) {
    throw new AppError('VALIDATION_FAILED', 'A station or legal entity is required');
  }
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId,
    ...(input.stationId ? { stationId: input.stationId } : {}),
  });
  const scope: AccessScope = input.stationId
    ? { tenantId: input.tenantId, scopeType: 'STATION', legalEntityId, stationId: input.stationId }
    : { tenantId: input.tenantId, scopeType: 'LEGAL_ENTITY', legalEntityId };
  return {
    authority: { ...authority, transaction },
    tenantId: input.tenantId,
    legalEntityId,
    ...(input.stationId ? { stationId: input.stationId } : {}),
    requestId: transaction.requestId ?? randomUUID(),
    scope,
  };
}

export async function resolveExpenseCommandContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId?: string;
  stationId?: string;
}): Promise<ExpenseCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.tenantId,
  });
  return bindExpenseScope({
    authority,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
  });
}

/** Mirrors the platform step-up gate: current strong authentication bound to this tenant. */
export function hasCurrentStepUp(context: ExpenseCommandContext, now: Date = new Date()): boolean {
  const actor = context.authority.authorization;
  return Boolean(
    actor.strongAuthenticationVerified === true &&
    actor.strongAuthenticationAt &&
    (!actor.strongAuthenticationExpiresAt || actor.strongAuthenticationExpiresAt > now) &&
    actor.stepUpTenantId === context.tenantId,
  );
}

export function assertStepUp(context: ExpenseCommandContext, why: string): void {
  if (!hasCurrentStepUp(context)) {
    throw new AppError(
      'STEP_UP_REQUIRED',
      `${why} requires a recent strong-authentication step-up`,
      {
        stepUpRequired: true,
      },
    );
  }
}

export function authorizeExpenseCommand(
  context: ExpenseCommandContext,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

/** True when the actor holds the permission, ignoring the step-up gate. */
export function holdsExpensePermission(
  context: ExpenseCommandContext,
  permissionCode: PermissionCode,
): boolean {
  return isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

async function runIdempotent<T>(
  transaction: ExpenseTransaction,
  input: { tenantId: string; commandType: string; idempotencyKey: string; requestHash: string },
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
  idempotencyKey: string;
  requestHash: string;
  audit: {
    subjectType: string;
    subjectId: string | ((result: T) => string);
    reason?: string;
    metadata?: Record<string, unknown>;
    /** Reads what the subject looked like before this command changes it. */
    before?: (transaction: ExpenseTransaction) => Promise<unknown>;
  };
  execute: (transaction: ExpenseTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  const policy = EXPENSE_COMMAND_POLICY[input.commandType];
  authorizeExpenseCommand(input.context, policy.permissionCode);
  if (policy.alwaysStepUp) assertStepUp(input.context, input.commandType);
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
        const before = input.audit.before ? await input.audit.before(transaction) : undefined;
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
            before,
            after: result,
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
