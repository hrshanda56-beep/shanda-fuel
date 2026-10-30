import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSelection } from '@/modules/context/persistence';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const STATION_1 = '00000000-0000-4000-8000-0000000000c1';
const STATION_2 = '00000000-0000-4000-8000-0000000000c2';

const resolve = vi.hoisted(() => vi.fn());
vi.mock('@/modules/context/queries', () => ({
  resolveCurrentContext: resolve,
  validateRequestedContext: vi.fn(),
  discoverAvailableContext: vi.fn(),
  filterAuthorizedContextRows: vi.fn(),
}));

import { GET } from './route';

const resolution = (stationId: string) => ({
  available: { organisations: [] },
  current: { organisationId: ORG, stationId, allStations: false },
  route: { pathname: '/inventory', policy: {} },
  persistedContextInvalid: false,
});

const get = (query: string, cookie?: string) =>
  GET(
    new Request(`http://localhost/api/context?pathname=/inventory&${query}`, {
      headers: cookie ? { cookie: `shanda-fuel-context=${cookie}` } : {},
    }),
  );

describe('GET /api/context saves a station named in the address (A1)', () => {
  beforeEach(() => resolve.mockReset());

  it('saves the station when none is saved yet', async () => {
    resolve.mockResolvedValue(resolution(STATION_1));
    const response = await get(`tenantId=${ORG}&stationId=${STATION_1}`);
    expect(response.headers.get('set-cookie')).toContain('shanda-fuel-context=');
  });

  it('replaces a saved station that differs', async () => {
    resolve.mockResolvedValue(resolution(STATION_1));
    const old = encodeSelection({ organisationId: ORG, stationId: STATION_2, allStations: false });
    const response = await get(`tenantId=${ORG}&stationId=${STATION_1}`, old);
    expect(response.headers.get('set-cookie')).toContain('shanda-fuel-context=');
  });

  it('does not rewrite the cookie when it already matches', async () => {
    resolve.mockResolvedValue(resolution(STATION_1));
    const same = encodeSelection({ organisationId: ORG, stationId: STATION_1, allStations: false });
    const response = await get(`tenantId=${ORG}&stationId=${STATION_1}`, same);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('leaves the saved choice alone when the address names no station', async () => {
    resolve.mockResolvedValue(resolution(STATION_2));
    const response = await get(`tenantId=${ORG}`);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
