import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sales: vi.fn() }));
vi.mock('@/modules/reporting/queries', () => ({ getDashboardSalesFromRequest: mocks.sales }));
vi.mock('@/platform/observability', () => ({
  withRequestObservability: (fn: unknown) => fn,
  apiErrorResponse: (_request: Request, error: { name?: string }) =>
    new Response('{}', { status: error.name === 'ZodError' ? 400 : 403 }),
}));
import { GET } from './route';
const tenant = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.resetAllMocks();
});
it('loads only sales for a chart range and disables response caching', async () => {
  mocks.sales.mockResolvedValue({ sales: { rows: [] } });
  const response = await GET(
    new Request(
      `http://localhost/api/dashboard/sales?tenantId=${tenant}&fromDate=2026-10-01&toDate=2026-10-18`,
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ sales: { rows: [] } });
  expect(mocks.sales).toHaveBeenCalledWith(expect.any(Request), {
    tenantId: tenant,
    fromDate: '2026-10-01',
    toDate: '2026-10-18',
  });
});
it('rejects malformed scope before reading', async () => {
  expect(
    (await GET(new Request('http://localhost/api/dashboard/sales?tenantId=invalid'))).status,
  ).toBe(400);
  expect(mocks.sales).not.toHaveBeenCalled();
});
it('propagates authorization failure without sales data', async () => {
  mocks.sales.mockRejectedValue(new Error('denied'));
  expect(
    (await GET(new Request(`http://localhost/api/dashboard/sales?tenantId=${tenant}`))).status,
  ).toBe(403);
});
