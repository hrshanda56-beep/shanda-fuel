import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  authority: vi.fn(),
  daily: vi.fn(),
  sales: vi.fn(),
  customers: vi.fn(),
  operations: vi.fn(),
}));
vi.mock('../../../modules/tenancy/authority', () => ({
  resolveTenantExecutionContext: mocks.authority,
}));
vi.mock('../../../modules/reporting/queries', () => ({
  getDailyOperationsFromRequest: mocks.daily,
  getDashboardSalesFromRequest: mocks.sales,
}));
vi.mock('../../../modules/customers/queries', () => ({
  getCustomerAccountsFromRequest: mocks.customers,
}));
vi.mock('../../../modules/forecourt/operations-overview', () => ({
  getOperationsOverviewFromRequest: mocks.operations,
}));
vi.mock('../../../platform/observability', () => ({
  withRequestObservability: (fn: unknown) => fn,
  apiErrorResponse: () => new Response('{}', { status: 403 }),
}));
import { GET } from './route';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authority.mockResolvedValue({});
  mocks.daily.mockResolvedValue({ rows: [] });
  mocks.sales.mockResolvedValue({ sales: { rows: [] } });
  mocks.customers.mockResolvedValue({ customers: [] });
  mocks.operations.mockResolvedValue({});
});
const tenant = '11111111-1111-4111-8111-111111111111';
it('combines summaries and avoids station operations for all-station scope', async () => {
  const response = await GET(new Request(`http://localhost/api/dashboard?tenantId=${tenant}`));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.daily.status).toBe('ready');
  expect(body.chart.data.sales.rows).toEqual([]);
  expect(mocks.operations).not.toHaveBeenCalled();
  expect(mocks.authority).toHaveBeenCalledTimes(1);
});
it('does not load any dashboard data if membership authorization fails', async () => {
  mocks.authority.mockRejectedValue(new Error('access denied'));
  expect((await GET(new Request(`http://localhost/api/dashboard?tenantId=${tenant}`))).status).toBe(
    403,
  );
  expect(mocks.daily).not.toHaveBeenCalled();
  expect(mocks.customers).not.toHaveBeenCalled();
  expect(mocks.sales).not.toHaveBeenCalled();
});
