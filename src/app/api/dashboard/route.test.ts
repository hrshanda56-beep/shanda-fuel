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

it('keeps chart dates out of the daily totals scope', async () => {
  await GET(
    new Request(
      `http://localhost/api/dashboard?tenantId=${tenant}&fromDate=2026-10-01&toDate=2026-10-18`,
    ),
  );
  expect(mocks.daily).toHaveBeenCalledWith(expect.any(Request), { tenantId: tenant });
  expect(mocks.sales).toHaveBeenCalledWith(expect.any(Request), {
    tenantId: tenant,
    fromDate: '2026-10-01',
    toDate: '2026-10-18',
  });
});

it('starts independent dashboard sections while daily totals are still pending', async () => {
  let release!: (value: { rows: never[] }) => void;
  mocks.daily.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = GET(new Request(`http://localhost/api/dashboard?tenantId=${tenant}`));
  await vi.waitFor(() => expect(mocks.sales).toHaveBeenCalled());
  expect(mocks.customers).toHaveBeenCalled();
  release({ rows: [] });
  expect((await pending).status).toBe(200);
});
