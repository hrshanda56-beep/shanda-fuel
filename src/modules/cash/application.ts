import 'server-only';

import { createHash } from 'node:crypto';
import { contextRoutePolicy, type ContextSelection } from '../context';
import { validateRequestedContext } from '../context/server';
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
  selection?: ContextSelection;
  /** @deprecated Kept for existing server callers; it is still revalidated. */
  requestedTenantId?: string;
  /** @deprecated Kept for existing server callers; it is still revalidated. */
  stationId?: string;
}): Promise<CashCommandContext> {
  const selection: ContextSelection =
    input.selection ??
    (input.requestedTenantId && input.stationId
      ? {
          organisationId: input.requestedTenantId,
          stationId: input.stationId,
          allStations: false,
        }
      : (() => {
          throw new AppError('VALIDATION_FAILED', 'A station context is required for cash');
        })());
  if (!selection.stationId || selection.allStations) {
    throw new AppError(
      'FORBIDDEN',
      'Choose one station you have access to in order to work with its cash',
    );
  }
  const pathname = `/stations/${encodeURIComponent(selection.stationId)}/cash`;
  const policy = contextRoutePolicy(pathname);
  if (policy.station !== 'required' || policy.allStationsAllowed) {
    throw new AppError('INVARIANT_VIOLATION', 'Cash must use the station-required context policy');
  }
  const validatedSelection = await validateRequestedContext(input.request, selection, {
    pathname,
    policy,
  });
  if (!validatedSelection.stationId || validatedSelection.allStations) {
    throw new AppError('FORBIDDEN', 'You do not have access to cash at this station');
  }
  return resolveForecourtCommandContext({
    request: input.request,
    requestedTenantId: validatedSelection.organisationId,
    stationId: validatedSelection.stationId,
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
  execute: (
    transaction: ForecourtTransaction,
  ) => Promise<{ result: T; before?: unknown; after?: unknown }>;
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
          before: outcome.before ?? input.before,
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
