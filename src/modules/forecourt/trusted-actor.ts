import 'server-only';

import {
  assertTrustedTenantTransactionContext,
  type TenantTransactionContext,
} from '../../platform/db/tenant-context';
import { AppError } from '../../platform/errors';

declare const trustedActorBrand: unique symbol;

export type TrustedActor = Readonly<{
  actorId: string;
  membershipId: string;
  tenantId: string;
  stationId: string;
  legalEntityId: string;
  requestId: string;
  readonly [trustedActorBrand]: 'a1';
}>;

const trustedActors = new WeakSet<object>();

export function createTrustedActor(input: {
  transaction: TenantTransactionContext;
  actorId: string;
  membershipId: string;
  tenantId: string;
  stationId: string;
  legalEntityId: string;
}): TrustedActor {
  assertTrustedTenantTransactionContext(input.transaction);
  if (
    input.transaction.tenantId !== input.tenantId ||
    input.transaction.actorId !== input.actorId ||
    input.transaction.membershipId !== input.membershipId
  ) {
    throw new AppError('FORBIDDEN', 'A3 actor provenance does not match A1 transaction authority');
  }
  const trusted = Object.freeze({
    ...input,
    requestId: input.transaction.requestId ?? '',
  }) as unknown as TrustedActor;
  trustedActors.add(trusted);
  return trusted;
}

export function assertTrustedActor(actor: TrustedActor): void {
  if (!actor || typeof actor !== 'object' || !trustedActors.has(actor)) {
    throw new AppError('FORBIDDEN', 'A server-resolved A1 actor context is required');
  }
}
