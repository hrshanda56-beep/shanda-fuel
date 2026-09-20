import { AppError } from '../../platform/errors';
import type { ForecourtEvent } from './contracts';

export type ForecourtCommandContext = {
  tenantId: string;
  stationId: string;
  actorId: string;
  membershipId: string;
  requestId: string;
};

export type IdempotencyRequest = {
  tenantId: string;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
};

export type IdempotencyPort = {
  run<T>(request: IdempotencyRequest, effect: () => Promise<T>): Promise<T>;
};

export type ForecourtAuditPort = {
  append(input: {
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
  publish(event: ForecourtEvent, context: ForecourtCommandContext): Promise<void>;
};

export type ForecourtCommandPorts = {
  authorize(): Promise<void>;
  idempotency: IdempotencyPort;
  audit: ForecourtAuditPort;
  outbox: ForecourtOutboxPort;
};

/**
 * Shared A3 command pipeline seam. Persistence adapters supply the existing
 * tenant transaction, idempotency registry, audit writer, and outbox writer;
 * the forecourt module does not create a parallel duplicate-prevention path.
 */
export async function executeForecourtCommand<T>(input: {
  context: ForecourtCommandContext;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
  subjectType: string;
  subjectId: string;
  ports: ForecourtCommandPorts;
  before?: unknown;
  reason?: string;
  execute: () => Promise<{ result: T; event?: ForecourtEvent; after?: unknown }>;
}): Promise<T> {
  await input.ports.authorize();
  if (!input.idempotencyKey.trim() || !input.requestHash.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Authoritative forecourt commands require idempotency and request hashes',
    );
  }
  return input.ports.idempotency.run(
    {
      tenantId: input.context.tenantId,
      commandType: input.commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    },
    async () => {
      const outcome = await input.execute();
      await input.ports.audit.append({
        context: input.context,
        commandType: input.commandType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        before: input.before,
        after: outcome.after,
        reason: input.reason,
      });
      if (outcome.event) await input.ports.outbox.publish(outcome.event, input.context);
      return outcome.result;
    },
  );
}
