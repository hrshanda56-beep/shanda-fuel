import { describe, expect, it } from 'vitest';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { money, unitPrice } from '../../platform/domain/primitives';
import { approvePriceChange, type SellingPrice } from './domain';
import { createTrustedActor } from './trusted-actor';

const tenantId = '11111111-1111-4111-8111-111111111111';
const stationId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const ownerId = '88888888-8888-4888-8888-888888888888';

const actor = createTrustedActor({
  transaction: createTrustedTenantTransactionContext({
    tenantId,
    actorId: memberId,
    membershipId: memberId,
    requestId: '44444444-4444-4444-8444-444444444444',
  }),
  actorId: memberId,
  membershipId: memberId,
  tenantId,
  stationId,
  legalEntityId: '55555555-5555-4555-8555-555555555555',
});

const pending = {
  id: '66666666-6666-4666-8666-666666666666',
  tenantId,
  stationId,
  productId: '77777777-7777-4777-8777-777777777777',
  effectiveFrom: '2026-10-26T00:00:00.000Z',
  unitPrice: unitPrice('1.800000'),
  currency: money('1.00').currency,
  requestedBy: memberId,
  version: 1,
  state: 'PENDING_APPROVAL',
} as SellingPrice;

describe('approving your own price change', () => {
  it('is refused while someone else could approve it', () => {
    expect(() => approvePriceChange(pending, actor, '2026-10-26T08:00:00.000Z')).toThrow(
      /requester/,
    );
    expect(() => approvePriceChange(pending, actor, '2026-10-26T08:00:00.000Z', true)).toThrow(
      /requester/,
    );
  });

  it('is allowed when nobody else at the station could approve it', () => {
    const approved = approvePriceChange(pending, actor, '2026-10-26T08:00:00.000Z', false);
    expect(approved.state).toBe('APPROVED');
    expect(approved.approvedBy).toBe(memberId);
  });
});

describe('a supervisor asks, the owner approves', () => {
  const ownerActor = createTrustedActor({
    transaction: createTrustedTenantTransactionContext({
      tenantId,
      actorId: ownerId,
      membershipId: ownerId,
      requestId: '99999999-9999-4999-8999-999999999999',
    }),
    actorId: ownerId,
    membershipId: ownerId,
    tenantId,
    stationId,
    legalEntityId: '55555555-5555-4555-8555-555555555555',
  });

  it('lets a different member (the owner) approve a request made by the supervisor', () => {
    const approved = approvePriceChange(pending, ownerActor, '2026-10-26T08:00:00.000Z', true);
    expect(approved.state).toBe('APPROVED');
    expect(approved.approvedBy).toBe(ownerId);
    expect(approved.requestedBy).toBe(memberId);
  });

  it('still refuses the supervisor approving their own request while an owner exists', () => {
    expect(() => approvePriceChange(pending, actor, '2026-10-26T08:00:00.000Z', true)).toThrow(
      /requester/,
    );
  });
});
