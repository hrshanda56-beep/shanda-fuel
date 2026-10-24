import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRequestReadScope } from '../../platform/security/request-read-scope';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), legacy: vi.fn(), identity: vi.fn() }));
vi.mock('./navigation-snapshot', async (original) => ({
  ...(await original<typeof import('./navigation-snapshot')>()),
  readNavigationSnapshot: mocks.snapshot,
}));
vi.mock('../identity', async (original) => ({
  ...(await original<typeof import('../identity')>()),
  requireAuthenticatedActor: mocks.identity,
}));
vi.mock('../tenancy/authority', async (original) => ({
  ...(await original<typeof import('../tenancy/authority')>()),
  loadTenantMembership: mocks.legacy,
}));
import { resolveStationReadAuthority } from './read-authority';
const actorId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const stationId = '33333333-3333-4333-8333-333333333333';
const legalEntityId = '44444444-4444-4444-8444-444444444444';
const membershipId = '55555555-5555-4555-8555-555555555555';
const actor = {
  identityId: actorId,
  session: { sessionId: actorId, userId: actorId, expiresAt: new Date('2099-01-01') },
};
const membership = {
  tenantId,
  membershipId,
  identityId: actorId,
  actorId,
  status: 'ACTIVE' as const,
  roleAssignments: [],
  temporaryGrants: [],
};
const row = {
  organisation_id: tenantId,
  organisation_name: 'Org',
  legal_entity_id: legalEntityId,
  legal_entity_name: 'Entity',
  station_id: stationId,
  station_code: 'S',
  station_name: 'Station',
  station_timezone: 'Africa/Harare',
};
const input = () => ({
  request: new Request('http://localhost/api/probe'),
  tenantId,
  stationId,
  authenticatedActor: actor,
});
beforeEach(() => {
  vi.stubEnv('CONSOLIDATED_CONTEXT_READS', '1');
  mocks.snapshot.mockResolvedValue([{ membership, rows: [row] }]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('station read authority', () => {
  it('returns trusted membership and station from the persisted snapshot', async () => {
    const result = await withRequestReadScope(() => resolveStationReadAuthority(input()));
    expect(result.authority.transaction).toMatchObject({ tenantId, membershipId, actorId });
    expect(result.station).toMatchObject({
      id: stationId,
      legalEntityId,
      timezone: 'Africa/Harare',
    });
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });
  it('denies a requested tenant missing from the snapshot', async () => {
    mocks.snapshot.mockResolvedValue([]);
    await expect(
      withRequestReadScope(() => resolveStationReadAuthority(input())),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects a membership bound to a different identity', async () => {
    mocks.snapshot.mockResolvedValue([
      { membership: { ...membership, identityId: stationId }, rows: [row] },
    ]);
    await expect(
      withRequestReadScope(() => resolveStationReadAuthority(input())),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('leaves historical station lookup to the existing RLS path', async () => {
    mocks.snapshot.mockResolvedValue([{ membership, rows: [] }]);
    const result = await withRequestReadScope(() => resolveStationReadAuthority(input()));
    expect(result.station).toBeUndefined();
  });
  it('rejects invalid tenant IDs before issuing a snapshot query', async () => {
    await expect(
      resolveStationReadAuthority({ ...input(), tenantId: 'invalid' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('propagates database failure instead of silently bypassing authorization', async () => {
    mocks.snapshot.mockRejectedValue(new Error('database unavailable'));
    await expect(resolveStationReadAuthority(input())).rejects.toThrow('database unavailable');
  });
});

it('rejects an expired forwarded session before reading persisted authority', async () => {
  const expiredActor = {
    ...actor,
    session: { ...actor.session, expiresAt: new Date('2000-01-01') },
  };
  await expect(
    resolveStationReadAuthority({ ...input(), authenticatedActor: expiredActor }),
  ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(mocks.snapshot).not.toHaveBeenCalled();
});

it('uses validated authority returned with identity without another database call', async () => {
  const navigationSnapshot = [
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      identity_id: actorId,
      roles: [],
      grants: [],
      context_rows: [row],
    },
  ];
  const result = await resolveStationReadAuthority({
    ...input(),
    authenticatedActor: { ...actor, navigationSnapshot },
  });
  expect(result.station?.id).toBe(stationId);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it('rejects cross-actor inline authority rather than falling back to another lookup', async () => {
  const navigationSnapshot = [
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      identity_id: stationId,
      roles: [],
      grants: [],
      context_rows: [row],
    },
  ];
  await expect(
    resolveStationReadAuthority({
      ...input(),
      authenticatedActor: { ...actor, navigationSnapshot },
    }),
  ).rejects.toThrow('Invalid navigation authority binding');
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
