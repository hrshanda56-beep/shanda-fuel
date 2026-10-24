import { beforeEach, expect, it, vi } from 'vitest';
import { resolveTenantExecutionContext } from '../tenancy/authority';
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  legacyStation: vi.fn(),
}));
vi.mock('../context/read-authority', () => ({ resolveStationReadAuthority: mocks.read }));
vi.mock('../../platform/db/transaction', () => ({ withTenantTransaction: mocks.transaction }));

import { withInventoryReadContext } from './application';
const tenantId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';
const stationId = '44444444-4444-4444-8444-444444444444';
const legalEntityId = '55555555-5555-4555-8555-555555555555';
const request = () => new Request('http://localhost/api/probe');
beforeEach(async () => {
  vi.clearAllMocks();
  const authority = await resolveTenantExecutionContext({
    request: request(),
    requestedTenantId: tenantId,
    authenticatedActor: {
      identityId: actorId,
      session: { sessionId: actorId, userId: actorId, expiresAt: new Date('2099-01-01') },
    },
    loadMembership: async () => ({
      tenantId,
      membershipId,
      identityId: actorId,
      actorId,
      status: 'ACTIVE',
      roleAssignments: [{ tenantId, roleCode: 'OWNER', scopeType: 'TENANT' }],
      temporaryGrants: [],
    }),
  });
  mocks.read.mockResolvedValue({
    authority,
    station: { id: stationId, tenantId, legalEntityId, timezone: 'Africa/Harare' },
  });
  mocks.transaction.mockImplementation(async (_context, work) => work({ execute: mocks.execute }));
  mocks.execute.mockResolvedValue([
    {
      id: stationId,
      code: 'S',
      name: 'Station',
      timezone: 'Africa/Harare',
      tenantId,
      tenantName: 'Org',
      now: '2026-10-18T12:00:00Z',
      days: [],
    },
  ]);
});
it('runs inventory work with snapshot station context without extra station queries', async () => {
  const work = vi.fn(async (_transaction, context) => ({ timezone: context.stationTimezone }));
  const result = await withInventoryReadContext(request(), tenantId, stationId, work);
  expect(result).toEqual({ timezone: 'Africa/Harare' });
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.transaction.mock.calls[0]?.[0]).toMatchObject({
    tenantId,
    stationId,
    legalEntityId,
    actorId,
    membershipId,
  });
});
it('does not run inventory work after authority rejection', async () => {
  mocks.read.mockRejectedValue(new Error('denied'));
  const work = vi.fn();
  await expect(withInventoryReadContext(request(), tenantId, stationId, work)).rejects.toThrow(
    'denied',
  );
  expect(work).not.toHaveBeenCalled();
});
it('propagates data failures through the transaction', async () => {
  await expect(
    withInventoryReadContext(request(), tenantId, stationId, async () => {
      throw new Error('data failure');
    }),
  ).rejects.toThrow('data failure');
});

it('forwards the already verified actor to avoid another identity lookup', async () => {
  const actor = {
    identityId: actorId,
    session: { sessionId: actorId, userId: actorId, expiresAt: new Date('2099-01-01') },
  };
  await withInventoryReadContext(request(), tenantId, stationId, async () => null, actor);
  expect(mocks.read.mock.calls[0]?.[0].authenticatedActor).toBe(actor);
});
