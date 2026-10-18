import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ContextResolution } from './contracts';
const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  daily: vi.fn(),
  record: vi.fn(),
  cash: vi.fn(),
  settlements: vi.fn(),
  valuation: vi.fn(),
  revaluation: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./server-page', () => ({ ServerDataPage: () => null }));
vi.mock('../forecourt/operations-overview', () => ({
  getOperationsOverviewFromRequest: mocks.overview,
}));
vi.mock('../forecourt/daily-operations', () => ({
  dailyOperationsQuery: { parse: (input: unknown) => input },
  getDailyOperationsContextFromRequest: mocks.daily,
}));
vi.mock('../forecourt/production-reconciliation', () => ({
  getProductionReconciliationFromRequest: mocks.record,
}));
vi.mock('../cash/queries', () => ({ getCashStationSummaryFromRequest: mocks.cash }));
vi.mock('../settlements/queries', () => ({
  getProviderSettlementSummaryFromRequest: mocks.settlements,
}));
vi.mock('../costing/queries', () => ({
  getInventoryValuationReadModel: mocks.valuation,
  getInventoryRevaluationReadModel: mocks.revaluation,
}));
vi.mock('../reporting/queries', () => ({ getManagementReportFromRequest: mocks.report }));
import { ServerOperationsOverview } from '../forecourt/server-overview';
import { ServerDailyOperations } from '../forecourt/server-daily';
import { ValuationPage } from '../costing/server-page';
import { ServerReportDetail } from '../reporting/server-pages';
const resolution: ContextResolution = {
  current: {
    organisationId: 'tenant',
    legalEntityId: 'entity',
    stationId: 'station',
    allStations: false,
  },
  persistedContextInvalid: false,
  available: {
    organisations: [
      {
        id: 'tenant',
        name: 'Organisation',
        legalEntities: [
          {
            id: 'entity',
            name: 'Entity',
            stations: [{ id: 'station', code: 'TST', name: 'Station', timezone: 'Africa/Harare' }],
          },
        ],
      },
    ],
  },
  route: {
    pathname: '/operations/daily',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
  },
};
const request = new Request('http://localhost/');
const context = {
  tenantId: 'untrusted-url-tenant',
  stationId: 'untrusted-url-station',
  businessDayId: 'day',
  shiftId: 'shift',
};
const loaders = [
  ['operations', () => ServerOperationsOverview({ search: {} })],
  ['daily', () => ServerDailyOperations({ search: {}, context })],
  ['valuation', () => ValuationPage({ search: {} })],
  ['revaluation', () => ValuationPage({ search: {}, revaluationId: 'revaluation' })],
  ['report', () => ServerReportDetail({ search: {}, view: 'profit-loss' })],
] as const;
function load(element: ReactElement, scope = resolution) {
  return (
    element.props as { load: (request: Request, scope: ContextResolution) => Promise<unknown> }
  ).load(request, scope);
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue({});
  mocks.cash.mockResolvedValue({ totals: {} });
  mocks.settlements.mockResolvedValue([]);
});
for (const [name, element] of loaders) {
  it(`${name}: starts initial data loading through shared server services`, async () => {
    expect(await load(element())).not.toBeNull();
    expect(Object.values(mocks).some((mock) => mock.mock.calls.length > 0)).toBe(true);
  });
  it(`${name}: makes no data query without validated current context`, async () => {
    expect(await load(element(), { ...resolution, current: null })).toBeNull();
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });
}
it('uses validated scope instead of trusting Daily Operations URL dimensions', async () => {
  await load(ServerDailyOperations({ search: {}, context }));
  expect(mocks.daily).toHaveBeenCalledWith(
    request,
    expect.objectContaining({ tenantId: 'tenant', stationId: 'station' }),
  );
});
it('propagates primary report failure for the boundary to render unavailable', async () => {
  mocks.report.mockRejectedValue(new Error('unavailable'));
  await expect(load(ServerReportDetail({ search: {}, view: 'profit-loss' }))).rejects.toThrow(
    'unavailable',
  );
});
