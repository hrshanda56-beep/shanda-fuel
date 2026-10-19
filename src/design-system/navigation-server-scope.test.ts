import { beforeEach, expect, it, vi } from 'vitest';
import type { ContextResolution } from '@/modules/context/contracts';
const mocks = vi.hoisted(() => ({ authority: vi.fn(), projection: vi.fn() }));
vi.mock('@/modules/tenancy/server', () => ({ resolveTenantExecutionContext: mocks.authority }));
vi.mock('./navigation-projection', async (original) => ({
  ...(await original<typeof import('./navigation-projection')>()),
  buildNavigationProjection: mocks.projection,
}));
import { getServerShellAccessForResolution } from './navigation-server';
const current = {
  organisationId: 'tenant-a',
  legalEntityId: 'entity-a',
  stationId: 'station-a',
  allStations: false,
};
const resolution: ContextResolution = {
  current,
  available: { organisations: [] },
  persistedContextInvalid: false,
  route: {
    pathname: '/',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
  },
};
const access = { status: 'ready' as const, current, resolution, projection: [] };
const request = new Request('http://localhost/customers');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authority.mockResolvedValue({ authorization: {} });
  mocks.projection.mockReturnValue([]);
});
it('reuses navigation when the validated selected scope has not changed', async () => {
  expect((await getServerShellAccessForResolution(request, access, resolution)).current).toEqual(
    current,
  );
  expect(mocks.authority).not.toHaveBeenCalled();
});
it('reprojects navigation against the validated target scope', async () => {
  const next = {
    ...resolution,
    current: {
      ...current,
      organisationId: 'tenant-b',
      legalEntityId: 'entity-b',
      stationId: 'station-b',
    },
  };
  const result = await getServerShellAccessForResolution(request, access, next);
  expect(result.current).toEqual(next.current);
  expect(result.resolution).toBe(next);
  expect(mocks.authority).toHaveBeenCalledWith({ request, requestedTenantId: 'tenant-b' });
  expect(mocks.projection).toHaveBeenCalledWith({
    actor: {},
    scope: {
      tenantId: 'tenant-b',
      scopeType: 'STATION',
      legalEntityId: 'entity-b',
      stationId: 'station-b',
    },
  });
});
it('fails closed if the new scope cannot produce an authorized projection', async () => {
  mocks.authority.mockRejectedValue(new Error('denied'));
  await expect(
    getServerShellAccessForResolution(request, access, {
      ...resolution,
      current: { ...current, stationId: 'different' },
    }),
  ).rejects.toThrow('denied');
});
