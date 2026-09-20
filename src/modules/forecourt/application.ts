import { AppError } from '../../platform/errors';
import {
  authorize,
  type AccessScope,
  type PermissionCode,
} from '../../platform/security/permissions';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/authority';
import { createTrustedActor, type TrustedActor } from './trusted-actor';
import type { ForecourtEvent } from './contracts';

/** A station context is created only from A1 authority and a server-loaded station. */
export type ForecourtCommandContext = Readonly<{
  authority: TenantExecutionContext;
  actor: TrustedActor;
  scope: AccessScope;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  requestId: string;
}>;

const trustedForecourtContexts = new WeakSet<object>();

export function createForecourtCommandContext(input: {
  authority: TenantExecutionContext;
  station: Readonly<{ id: string; tenantId: string; legalEntityId: string }>;
}): ForecourtCommandContext {
  const { authority, station } = input;
  if (
    authority.membership.tenantId !== station.tenantId ||
    authority.transaction.tenantId !== station.tenantId ||
    authority.transaction.actorId !== authority.actor.identityId ||
    authority.transaction.membershipId !== authority.membership.membershipId
  ) {
    throw new AppError('FORBIDDEN', 'The station does not belong to the trusted tenant context');
  }
  const context = Object.freeze({
    authority,
    actor: createTrustedActor({
      transaction: authority.transaction,
      actorId: authority.actor.identityId,
      membershipId: authority.membership.membershipId,
      tenantId: station.tenantId,
      stationId: station.id,
      legalEntityId: station.legalEntityId,
    }),
    scope: {
      tenantId: station.tenantId,
      scopeType: 'STATION' as const,
      legalEntityId: station.legalEntityId,
      stationId: station.id,
    },
    tenantId: station.tenantId,
    legalEntityId: station.legalEntityId,
    stationId: station.id,
    requestId: authority.transaction.requestId ?? '',
  });
  trustedForecourtContexts.add(context);
  return context;
}

/** Better Auth -> A1 authority -> server-loaded station -> A3 context. */
export async function resolveForecourtCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId: string;
  loadStation: (
    authority: TenantExecutionContext,
    stationId: string,
  ) => Promise<Readonly<{ id: string; tenantId: string; legalEntityId: string }> | null>;
}): Promise<ForecourtCommandContext> {
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
  });
  const station = await input.loadStation(authority, input.stationId);
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
  return createForecourtCommandContext({ authority, station });
}

export type IdempotencyRequest = Readonly<{
  tenantId: string;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
}>;

export type ForecourtTransaction = unknown;

export type ForecourtTransactionPort = {
  run<T>(
    context: ForecourtCommandContext,
    work: (transaction: ForecourtTransaction) => Promise<T>,
  ): Promise<T>;
};

export type IdempotencyPort = {
  run<T>(
    transaction: ForecourtTransaction,
    request: IdempotencyRequest,
    effect: () => Promise<T>,
  ): Promise<T>;
};

export type ForecourtAuditPort = {
  append(input: {
    transaction: ForecourtTransaction;
    context: ForecourtCommandContext;
    commandType: string;
    subjectType: string;
    subjectId: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  }): Promise<void>;
};

export type ForecourtOutboxPort = {
  publish(input: {
    transaction: ForecourtTransaction;
    event: ForecourtEvent;
    context: ForecourtCommandContext;
  }): Promise<void>;
};

export type ForecourtCommandPorts = {
  transaction: ForecourtTransactionPort;
  idempotency: IdempotencyPort;
  audit: ForecourtAuditPort;
  outbox: ForecourtOutboxPort;
};

export type ForecourtCommandInput<T> = Readonly<{
  context: ForecourtCommandContext;
  commandType: string;
  permissionCode: PermissionCode;
  idempotencyKey: string;
  requestHash: string;
  subjectType: string;
  subjectId: string;
  ports: ForecourtCommandPorts;
  before?: unknown;
  reason?: string;
  responsibleAttendantId?: string;
  assertAttendantEligible?: (
    transaction: ForecourtTransaction,
    attendantId: string,
    stationId: string,
  ) => Promise<void>;
  expectedVersion?: number;
  assertExpectedVersion?: (
    transaction: ForecourtTransaction,
    expectedVersion: number,
  ) => Promise<void>;
  execute: (
    transaction: ForecourtTransaction,
  ) => Promise<{ result: T; event?: ForecourtEvent; after?: unknown }>;
}>;

/** The complete authoritative command unit. */
export async function executeForecourtCommand<T>(input: ForecourtCommandInput<T>): Promise<T> {
  assertTrustedContext(input.context);
  if (!input.idempotencyKey.trim() || !input.requestHash.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Authoritative forecourt commands require idempotency and request hashes',
    );
  }

  return input.ports.transaction.run(input.context, async (transaction) => {
    authorize({
      actor: input.context.authority.authorization,
      permissionCode: input.permissionCode,
      requestedScope: input.context.scope,
    });
    if (input.responsibleAttendantId !== undefined) {
      if (!input.assertAttendantEligible) {
        throw new AppError(
          'VALIDATION_FAILED',
          'On-behalf-of commands require a transaction-bound station eligibility check',
        );
      }
      await input.assertAttendantEligible(
        transaction,
        input.responsibleAttendantId,
        input.context.stationId,
      );
    }
    if (input.expectedVersion !== undefined) {
      if (!input.assertExpectedVersion) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Commands with an expected version require a transaction-bound version check',
        );
      }
      await input.assertExpectedVersion(transaction, input.expectedVersion);
    }

    return input.ports.idempotency.run(
      transaction,
      {
        tenantId: input.context.tenantId,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      async () => {
        const outcome = await input.execute(transaction);
        await input.ports.audit.append({
          transaction,
          context: input.context,
          commandType: input.commandType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          before: input.before,
          after: outcome.after,
          reason: input.reason,
        });
        if (outcome.event) {
          await input.ports.outbox.publish({
            transaction,
            event: outcome.event,
            context: input.context,
          });
        }
        return outcome.result;
      },
    );
  });
}

function assertTrustedContext(context: ForecourtCommandContext): void {
  if (!context || typeof context !== 'object' || !trustedForecourtContexts.has(context)) {
    throw new AppError('FORBIDDEN', 'A server-resolved A1 station context is required');
  }
}
