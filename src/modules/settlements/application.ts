import 'server-only';

import { createHash } from 'node:crypto';
import { AppError } from '../../platform/errors';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import {
  databaseForecourtTransactionPort,
  type ForecourtCommandContext,
  type ForecourtTransaction,
  resolveForecourtCommandContext,
} from '../forecourt/application';
import {
  databaseAuditPort,
  databaseIdempotencyPort,
  loadForecourtStation,
} from '../forecourt/persistence';

export type SettlementCommandContext = ForecourtCommandContext;

export async function resolveSettlementCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId: string;
}): Promise<SettlementCommandContext> {
  return resolveForecourtCommandContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
}

export function authorizeSettlementCommand(
  context: SettlementCommandContext,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

export function authorizeSettlementTenantCommand(
  context: SettlementCommandContext,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
  });
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function executeSettlementCommand<T>(input: {
  context: SettlementCommandContext;
  commandType: string;
  permissionCode: PermissionCode;
  idempotencyKey: string;
  requestHash: string;
  subjectType: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  auditMetadata?: Readonly<Record<string, string | null>>;
  authorizeTenantScope?: boolean;
  execute: (transaction: ForecourtTransaction) => Promise<{ result: T; after?: unknown }>;
}): Promise<T> {
  if (!input.idempotencyKey.trim() || !input.requestHash.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Authoritative settlement commands require idempotency and request hashes',
    );
  }
  if (input.authorizeTenantScope) {
    authorizeSettlementTenantCommand(input.context, input.permissionCode);
  } else {
    authorizeSettlementCommand(input.context, input.permissionCode);
  }

  return databaseForecourtTransactionPort.run(input.context, async (transaction) =>
    databaseIdempotencyPort.run(
      transaction,
      {
        tenantId: input.context.tenantId,
        commandType: `Settlement.${input.commandType}`,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      async () => {
        const outcome = await input.execute(transaction);
        await databaseAuditPort.append({
          transaction,
          context: input.context,
          auditNamespace: 'SETTLEMENT',
          commandType: input.commandType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          before: input.before,
          after: outcome.after ?? input.after,
          reason: input.reason,
          auditMetadata: input.auditMetadata,
          provenance: {
            actorId: input.context.actor.actorId,
            membershipId: input.context.actor.membershipId,
            tenantId: input.context.tenantId,
            stationId: input.context.stationId,
            requestId: input.context.requestId,
          },
        });
        return outcome.result;
      },
    ),
  );
}
