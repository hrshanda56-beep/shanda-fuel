import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), overview: vi.fn() }));
vi.mock('../../../../modules/identity', () => ({ requireAuthenticatedActor: mocks.actor }));
vi.mock('../../../../modules/settlements/queries', async (original) => ({
  ...(await original<typeof import('../../../../modules/settlements/queries')>()),
  getSettlementOverviewFromRequest: mocks.overview,
}));
import { GET } from './route';
import { AppError } from '../../../../platform/errors';
const actor = { identityId: 'actor' };
const url =
  'http://localhost/api/settlements/overview?tenantId=11111111-1111-4111-8111-111111111111&stationId=22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue(actor);
  mocks.overview.mockResolvedValue({ settlements: [], unmatched: [] });
});
it('returns both sections from one authorized read with no-store', async () => {
  const response = await GET(new Request(url));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ settlements: [], unmatched: [] });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.overview).toHaveBeenCalledTimes(1);
  expect(mocks.overview.mock.calls[0]?.[2]).toBe(actor);
});
it('rejects unauthenticated access without loading data', async () => {
  mocks.actor.mockRejectedValue(new AppError('UNAUTHENTICATED', 'Sign in required'));
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.overview).not.toHaveBeenCalled();
});
it('rejects malformed context before loading data', async () => {
  expect((await GET(new Request('http://localhost/api/settlements/overview'))).status).toBe(400);
  expect(mocks.overview).not.toHaveBeenCalled();
});
