import 'server-only';

import { createHash } from 'node:crypto';
import { AppError } from '../../platform/errors';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import {
  resolveForecourtCommandContext,
  databaseForecourtTransactionPort,
  type ForecourtCommandContext,
  type ForecourtTransaction,
} from '../forecourt/application';
import {
  databaseAuditPort,
  databaseIdempotencyPort,
  loadForecourtStation,
} from '../forecourt/persistence';

export type CashCommandContext = ForecourtCommandContext;

export async function resolveCashCommandContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId: string;
}): Promise<CashCommandContext> {
  return resolveForecourtCommandContext({
    request: input.request,
    requestedTenantId: input.requestedTenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
}

export function authorizeCashCommand(
  context: CashCommandContext,
  permissionCode: PermissionCode,
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

export async function executeCashCommand<T>(input: {
  context: CashCommandContext;
  commandType: string;
  permissionCode: PermissionCode;
  idempotencyKey: string;
  requestHash: string;
  subjectType: string;
  subjectId: string;
  before?: unknown;
  execute: (transaction: ForecourtTransaction) => Promise<{ result: T; after?: unknown }>;
}): Promise<T> {
  if (!input.idempotencyKey.trim() || !input.requestHash.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Authoritative cash commands require idempotency and request hashes',
    );
  }
  authorizeCashCommand(input.context, input.permissionCode);

  return databaseForecourtTransactionPort.run(input.context, async (transaction) =>
    databaseIdempotencyPort.run(
      transaction,
      {
        tenantId: input.context.tenantId,
        commandType: `Cash.${input.commandType}`,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      async () => {
        const outcome = await input.execute(transaction);
        await databaseAuditPort.append({
          transaction,
          context: input.context,
          auditNamespace: 'CASH',
          commandType: input.commandType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          before: input.before,
          after: outcome.after,
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
