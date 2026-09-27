import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { getServerEnv } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { assertStepUp } from '../../platform/security';
import {
  authorize,
  type AccessScope,
  type PermissionCode,
} from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { forecourtIdempotencyRecords } from '../../platform/db/schema/a3';
import type {
  CustomerAccountAuditActionCode,
  CustomerFuelAuthorizationCommand,
  CustomerFuelPostingRequest,
  CustomerFuelUsageCommand,
  CustomerPaymentCommand,
  PrepaidTopUpCommand,
} from './contracts';

export const CUSTOMER_PERMISSION_CODES = [
  'customer.view',
  'customer.manage',
  'customer.account.manage',
  'customer.credit.authorize',
  'customer.prepaid.top_up',
  'customer.payment.record',
  'customer.statement.view',
  'customer.account.adjust',
  'customer.limit.override',
] as const;
export type CustomerPermissionCode = (typeof CUSTOMER_PERMISSION_CODES)[number];

export const CUSTOMER_COMMAND_TYPES = [
  'CreateCustomer',
  'CreateCustomerAccount',
  'RequestCustomerFuelAuthorization',
  'AuthorizeCustomerFuel',
  'CompleteCustomerFuelTransaction',
  'CancelCustomerFuelAuthorization',
  'ExpireCustomerFuelAuthorization',
  'RecordCustomerPayment',
  'RecordPrepaidTopUp',
  'ReverseCustomerLedgerEntry',
] as const;
export type CustomerCommandType = (typeof CUSTOMER_COMMAND_TYPES)[number];

export type CustomerCommandEnvelope<TPayload> = Readonly<{
  commandType: CustomerCommandType;
  idempotencyKey: string;
  requestHash: string;
  payload: TPayload;
}>;

export type CustomerApplicationCommand =
  | CustomerCommandEnvelope<CustomerFuelAuthorizationCommand>
  | CustomerCommandEnvelope<CustomerFuelUsageCommand>
  | CustomerCommandEnvelope<CustomerPaymentCommand>
  | CustomerCommandEnvelope<PrepaidTopUpCommand>
  | CustomerCommandEnvelope<CustomerFuelPostingRequest>;

export type CustomerCommandPolicy = Readonly<{
  permissionCode: CustomerPermissionCode;
  scopeType: 'TENANT' | 'STATION';
  requiresStepUp: boolean;
  requiresExpectedVersion: boolean;
}>;

export const CUSTOMER_COMMAND_POLICY: Readonly<
  Partial<Record<CustomerCommandType, CustomerCommandPolicy>>
> = {
  CreateCustomer: {
    permissionCode: 'customer.manage',
    scopeType: 'TENANT',
    requiresStepUp: false,
    requiresExpectedVersion: false,
  },
  CreateCustomerAccount: {
    permissionCode: 'customer.account.manage',
    scopeType: 'TENANT',
    requiresStepUp: true,
    requiresExpectedVersion: false,
  },
  RequestCustomerFuelAuthorization: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  AuthorizeCustomerFuel: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: true,
    requiresExpectedVersion: true,
  },
  CompleteCustomerFuelTransaction: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  RecordCustomerPayment: {
    permissionCode: 'customer.payment.record',
    scopeType: 'TENANT',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  RecordPrepaidTopUp: {
    permissionCode: 'customer.prepaid.top_up',
    scopeType: 'TENANT',
    requiresStepUp: true,
    requiresExpectedVersion: true,
  },
  ReverseCustomerLedgerEntry: {
    permissionCode: 'customer.account.adjust',
    scopeType: 'TENANT',
    requiresStepUp: true,
    requiresExpectedVersion: true,
  },
  CancelCustomerFuelAuthorization: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
  ExpireCustomerFuelAuthorization: {
    permissionCode: 'customer.credit.authorize',
    scopeType: 'STATION',
    requiresStepUp: false,
    requiresExpectedVersion: true,
  },
};

export type CustomerExecutionContext = Readonly<{
  tenantId: string;
  actorId: string;
  membershipId: string;
  requestId: string;
  scope: AccessScope;
}>;

export type CustomerIdempotencyRequest = Readonly<{
  tenantId: string;
  commandType: CustomerCommandType;
  idempotencyKey: string;
  requestHash: string;
}>;

export type CustomerAuditRequest = Readonly<{
  actionCode: CustomerAccountAuditActionCode;
  subjectType: 'Customer' | 'CustomerAccount' | 'CustomerFuelAuthorization' | 'CustomerLedgerEntry';
  subjectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}>;

export type CustomerPostingIntegrationRequirement = Readonly<{
  source: 'A5';
  evidenceEvent: 'a5.customer_fuel_allocation_posted.v1';
  uniquenessKey: Readonly<{
    tenantId: string;
    paymentEvidenceId: string;
    reconciliationRevisionId: string;
  }>;
  retryRule: 'same-source-reference-returns-existing-entry';
}>;

export type CustomerTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type CustomerCommandContext = Readonly<{
  authority: TenantExecutionContext;
  tenantId: string;
  requestId: string;
  scope: AccessScope;
  stationId?: string;
}>;

export async function resolveCustomerCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId?: string;
}): Promise<CustomerCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });
  if (!input.stationId) {
    return {
      authority,
      tenantId: input.requestedTenantId,
      requestId: authority.transaction.requestId ?? randomUUID(),
      scope: { tenantId: input.requestedTenantId, scopeType: 'TENANT' },
    };
  }
  const stations = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{ id: string; legal_entity_id: string }>(sql`
      select id, legal_entity_id
      from app.stations
      where tenant_id = ${input.requestedTenantId} and id = ${input.stationId} and status = 'ACTIVE'
      limit 1
    `),
  );
  const station = stations[0];
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: station.legal_entity_id,
    stationId: station.id,
  });
  return {
    authority: { ...authority, transaction },
    tenantId: input.requestedTenantId,
    requestId: transaction.requestId ?? randomUUID(),
    stationId: station.id,
    scope: {
      tenantId: input.requestedTenantId,
      scopeType: 'STATION',
      legalEntityId: station.legal_entity_id,
      stationId: station.id,
    },
  };
}

export function authorizeCustomerCommand(
  context: CustomerCommandContext,
  permissionCode: CustomerPermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode: permissionCode as PermissionCode,
    requestedScope: context.scope,
  });
}

export function assertCustomerCommandAuthorization(input: {
  context: CustomerCommandContext;
  commandType: CustomerCommandType;
  permissionCode: CustomerPermissionCode;
}): void {
  const policy = CUSTOMER_COMMAND_POLICY[input.commandType];
  if (!policy) {
    throw new AppError('INVARIANT_VIOLATION', 'The customer command has no authorization policy');
  }
  if (policy.permissionCode !== input.permissionCode) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The customer command permission does not match its authorization policy',
    );
  }
  authorizeCustomerCommand(input.context, input.permissionCode);
  if (policy.requiresStepUp) {
    assertStepUp(
      input.context.authority.actor.session,
      1,
      new Date(),
      input.context.scope.tenantId,
    );
  }
}

export function customerRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function executeCustomerCommand<T>(input: {
  context: CustomerCommandContext;
  commandType: CustomerCommandType;
  permissionCode: CustomerPermissionCode;
  idempotencyKey: string;
  requestHash: string;
  audit: {
    actionCode: CustomerAccountAuditActionCode;
    subjectType: CustomerAuditRequest['subjectType'];
    subjectId: string | ((result: unknown) => string);
    before?: unknown;
    after?: unknown;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  execute: (transaction: CustomerTransaction) => Promise<T>;
}): Promise<T> {
  if (!input.idempotencyKey.trim())
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  assertCustomerCommandAuthorization(input);
  return withTenantTransaction(input.context.authority.transaction, async (transaction) => {
    const commandType = `Customer.${input.commandType}`;
    const inserted = await transaction
      .insert(forecourtIdempotencyRecords)
      .values({
        tenantId: input.context.tenantId,
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
            eq(forecourtIdempotencyRecords.tenantId, input.context.tenantId),
            eq(forecourtIdempotencyRecords.commandType, commandType),
            eq(forecourtIdempotencyRecords.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for('update');
      const row = existing[0];
      if (!row) throw new AppError('CONFLICT', 'The customer idempotency record disappeared');
      if (row.requestHash !== input.requestHash)
        throw new AppError('IDEMPOTENCY_CONFLICT', 'The idempotency key was reused with new data');
      if (row.status !== 'COMPLETED')
        throw new AppError('CONFLICT', 'The customer command is already in progress');
      return (row.resultPayload as { value: T }).value;
    }
    const result = await input.execute(transaction);
    const env = getServerEnv();
    if (!env.AUDIT_SIGNING_KEY_ID || !env.AUDIT_SIGNING_KEY)
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Audit signing credentials are not configured');
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
        metadata: { ...(input.audit.metadata ?? {}), stationId: input.context.stationId ?? null },
      },
      { keyId: env.AUDIT_SIGNING_KEY_ID, secret: env.AUDIT_SIGNING_KEY },
      transaction,
    );
    await transaction
      .update(forecourtIdempotencyRecords)
      .set({
        status: 'COMPLETED',
        resultPayload: { value: JSON.parse(JSON.stringify(result)) },
        completedAt: new Date(),
      })
      .where(eq(forecourtIdempotencyRecords.id, inserted[0]!.id));
    return result;
  });
}
