import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';
import type {
  SupplierCommandEnvelope,
  SupplierCommandType,
  SupplierSourceReference,
} from './contracts';
import { SUPPLIER_COMMAND_POLICY } from './contracts';

export function supplierRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export const requestHash = supplierRequestHash;

export type SupplierTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type SupplierCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  legalEntityId: string;
  requestId: string;
  scope: {
    tenantId: string;
    scopeType: 'LEGAL_ENTITY';
    legalEntityId: string;
  };
}>;

export async function resolveSupplierCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  legalEntityId: string;
}): Promise<SupplierCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{ id: string; tenant_id: string }>(sql`
      select id, tenant_id
      from app.legal_entities
      where tenant_id = ${input.requestedTenantId}
        and id = ${input.legalEntityId}
        and status = 'ACTIVE'
      limit 1
    `),
  );
  const entity = rows[0];
  if (!entity) throw new AppError('NOT_FOUND', 'The requested legal entity was not found');
  if (entity.tenant_id !== authority.membership.tenantId) {
    throw new AppError('FORBIDDEN', 'The legal entity is outside the trusted tenant context');
  }
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: entity.id,
  });
  return {
    authority: { ...authority, transaction },
    tenantId: entity.tenant_id,
    legalEntityId: entity.id,
    requestId: transaction.requestId ?? randomUUID(),
    scope: { tenantId: entity.tenant_id, scopeType: 'LEGAL_ENTITY', legalEntityId: entity.id },
  };
}

export function authorizeSupplierCommand(
  context: SupplierCommandContext,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

async function runIdempotent<T>(
  transaction: SupplierTransaction,
  input: { tenantId: string; commandType: string; idempotencyKey: string; requestHash: string },
  effect: () => Promise<T>,
): Promise<T> {
  const commandType = `Supplier.${input.commandType}`;
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
    if (!row) throw new AppError('CONFLICT', 'The supplier idempotency record disappeared');
    if (row.requestHash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
    }
    if (row.status !== 'COMPLETED') {
      throw new AppError('CONFLICT', 'The supplier command is already in progress');
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

export async function executeSupplierCommand<T>(input: {
  context: SupplierCommandContext;
  commandType: SupplierCommandType;
  permissionCode: PermissionCode;
  idempotencyKey: string;
  requestHash: string;
  audit: {
    actionCode: string;
    subjectType: string;
    subjectId: string | ((result: unknown) => string);
    before?: unknown;
    /** Reads what the subject looked like before this command changes it. */
    readBefore?: (transaction: SupplierTransaction) => Promise<unknown>;
    after?: unknown;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  execute: (transaction: SupplierTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  }
  authorizeSupplierCommand(input.context, input.permissionCode);
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
              legalEntityId: input.context.legalEntityId,
              ...(input.audit.metadata ?? {}),
            },
          },
          auditKey,
          transaction,
        );
        return result;
      },
    ),
  );
}

export function validateSupplierCommandEnvelope(
  input: SupplierCommandEnvelope,
): SupplierCommandEnvelope {
  const policy = SUPPLIER_COMMAND_POLICY[input.commandType];
  if (!policy) throw new AppError('VALIDATION_FAILED', 'Unsupported supplier command');
  for (const [field, value] of Object.entries(input)) {
    if (field === 'expectedVersion') continue;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AppError('VALIDATION_FAILED', `${field} is required`);
    }
  }
  if (policy.requiresExpectedVersion && input.expectedVersion === undefined) {
    throw new AppError('VALIDATION_FAILED', `${input.commandType} requires an expected version`);
  }
  if (
    input.expectedVersion !== undefined &&
    (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
  ) {
    throw new AppError('VALIDATION_FAILED', 'Expected version must be a non-negative integer');
  }
  return input;
}

export function validateSupplierSourceReference(
  reference: SupplierSourceReference,
): SupplierSourceReference {
  if (!reference.tenantId.trim() || !reference.sourceId.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Supplier source references require tenant and source identifiers',
    );
  }
  if (reference.sourceType === 'A4_DELIVERY' && !reference.stationId?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'A4 delivery references require station scope');
  }
  return reference;
}

export function assertSupplierSourceReferencesSameTenant(
  tenantId: string,
  references: readonly SupplierSourceReference[],
): void {
  for (const reference of references) {
    validateSupplierSourceReference(reference);
    if (reference.tenantId !== tenantId) {
      throw new AppError(
        'FORBIDDEN',
        'Supplier source references must belong to the command tenant',
      );
    }
  }
}

export function requiredSupplierCommandPermission(commandType: SupplierCommandType): string {
  return SUPPLIER_COMMAND_POLICY[commandType].permissionCode;
}
