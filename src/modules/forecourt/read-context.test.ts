import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), station: vi.fn() }));
vi.mock('../context/read-authority', () => ({ resolveStationReadAuthority: mocks.read }));
vi.mock('./persistence', () => ({ loadForecourtStation: mocks.station }));
import { resolveForecourtReadContext } from './read-context';
const tenantId = '11111111-1111-4111-8111-111111111111',
  actorId = '22222222-2222-4222-8222-222222222222',
  membershipId = '33333333-3333-4333-8333-333333333333',
  stationId = '44444444-4444-4444-8444-444444444444',
  legalEntityId = '55555555-5555-4555-8555-555555555555';
const authority = {
  actor: { identityId: actorId },
  membership: { tenantId, membershipId },
  transaction: { tenantId, actorId, membershipId },
  authorization: { membershipId },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({
    authority,
    station: { id: stationId, tenantId, legalEntityId },
    rows: [],
  });
});
it('uses persisted station metadata without a discovery transaction', async () => {
  const { context } = await resolveForecourtReadContext({
    request: new Request('http://localhost'),
    tenantId,
    stationId,
  });
  expect(context.authority.transaction).toMatchObject({
    tenantId,
    stationId,
    legalEntityId,
    actorId,
    membershipId,
  });
  expect(mocks.station).not.toHaveBeenCalled();
});
it('rejects a station belonging to a different tenant', async () => {
  mocks.read.mockResolvedValue({
    authority,
    station: { id: stationId, tenantId: actorId, legalEntityId },
    rows: [],
  });
  await expect(
    resolveForecourtReadContext({ request: new Request('http://localhost'), tenantId, stationId }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('retains the RLS lookup and not-found failure for historical or missing stations', async () => {
  mocks.read.mockResolvedValue({ authority, rows: [] });
  mocks.station.mockResolvedValue(null);
  await expect(
    resolveForecourtReadContext({ request: new Request('http://localhost'), tenantId, stationId }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(mocks.station).toHaveBeenCalledTimes(1);
});
