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
vi.mock('./persistence', () => ({ loadForecourtStationInTransaction: mocks.legacyStation }));
import { getOperationsOverviewFromRequest } from './operations-overview';
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
it('returns an empty control room using one data exchange and fully scoped transaction', async () => {
  const result = await getOperationsOverviewFromRequest(request(), { tenantId, stationId });
  expect(result.businessDays).toEqual([]);
  expect(result.station.id).toBe(stationId);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.transaction.mock.calls[0]?.[0]).toMatchObject({
    tenantId,
    stationId,
    legalEntityId,
    actorId,
    membershipId,
  });
  expect(mocks.legacyStation).not.toHaveBeenCalled();
});
it('keeps not-found behavior when station data disappears after authorization', async () => {
  mocks.execute.mockResolvedValue([]);
  await expect(
    getOperationsOverviewFromRequest(request(), { tenantId, stationId }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('does not open a data transaction if authorization fails', async () => {
  mocks.read.mockRejectedValue(new Error('denied'));
  await expect(
    getOperationsOverviewFromRequest(request(), { tenantId, stationId }),
  ).rejects.toThrow('denied');
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it('loads populated shifts and reconciliations together after the station/day snapshot', async () => {
  const day = {
    id: '66666666-6666-4666-8666-666666666666',
    date: '2026-10-18',
    state: 'OPEN',
    version: 1,
    openedAt: null,
    closedAt: null,
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
  };
  mocks.execute
    .mockResolvedValueOnce([
      {
        id: stationId,
        code: 'S',
        name: 'Station',
        timezone: 'Africa/Harare',
        tenantId,
        tenantName: 'Org',
        now: '2026-10-18T12:00:00Z',
        days: [day],
      },
    ])
    .mockResolvedValueOnce([{ shifts: [], reconciliations: [] }]);
  const result = await getOperationsOverviewFromRequest(request(), { tenantId, stationId });
  expect(result.selectedBusinessDay?.id).toBe(day.id);
  expect(result.shifts).toEqual([]);
  expect(result.reconciliations).toEqual([]);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
});
