import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  operations: vi.fn(),
  valuation: vi.fn(),
  cash: vi.fn(),
  settlements: vi.fn(),
  finance: vi.fn(),
}));
vi.mock('@/modules/forecourt/operations-overview', () => ({
  getOperationsOverviewFromRequest: mocks.operations,
}));
vi.mock('@/modules/costing/queries', () => ({ getInventoryValuationReadModel: mocks.valuation }));
vi.mock('@/modules/cash/queries', () => ({ getCashStationSummaryFromRequest: mocks.cash }));
vi.mock('@/modules/settlements/queries', () => ({
  getSettlementOverviewFromRequest: mocks.settlements,
}));
vi.mock('@/modules/approvals/action-center', () => ({ loadActionCenterFacts: mocks.finance }));
vi.mock('@/modules/approvals', () => ({ buildActionCenter: (value: unknown) => value }));
vi.mock('@/modules/identity', () => ({
  requireAuthenticatedActor: async () => ({ identityId: 'actor' }),
}));
import { loadPortfolioStation } from './portfolio-data';
const request = new Request('http://localhost');
const selection = {
  organisationId: 'tenant',
  legalEntityId: 'entity',
  stationId: 'station',
  allStations: false,
};
beforeEach(() => vi.resetAllMocks());
it('loads operations through the existing authorization boundary and links exact records', async () => {
  mocks.operations.mockResolvedValue({
    currentBusinessDate: '2026-10-18',
    status: { close: 'OPEN', approval: 'PENDING_APPROVAL' },
    shifts: [{}],
    selectedBusinessDay: { id: 'day' },
    reconciliations: [{ id: 'record', shiftId: 'shift', state: 'SUBMITTED' }],
  });
  const facts = await loadPortfolioStation(request, selection, 'operations');
  expect(mocks.operations).toHaveBeenCalledWith(request, {
    tenantId: 'tenant',
    stationId: 'station',
  });
  expect(facts.at(-1)?.href).toContain('reconciliationId=record');
  expect(facts.at(-1)?.href).toContain('stationId=station');
});
it('preserves exact cash decimals and currency without cross-station arithmetic', async () => {
  mocks.cash.mockResolvedValue({
    currency: 'USD',
    totals: { collectedButUnbanked: '999999999999.1234' },
  });
  expect(await loadPortfolioStation(request, selection, 'cash')).toEqual([
    { label: 'collected But Unbanked', value: 'USD 999999999999.1234' },
  ]);
});
it('reads settlement and unmatched counts from the combined service', async () => {
  mocks.settlements.mockResolvedValue({ settlements: [{}, {}], unmatched: [{}] });
  expect(await loadPortfolioStation(request, selection, 'settlements')).toEqual([
    { label: 'Settlements', value: '2' },
    { label: 'Unmatched payments', value: '1' },
  ]);
});
it('preserves valuation quantities and individual stream labels', async () => {
  mocks.valuation.mockResolvedValue({
    streams: [
      {
        tank: { id: 'tank', code: 'Tank 1' },
        product: { id: 'diesel', name: 'Diesel' },
        quantityLitres: '123.4567',
        valuationStatus: 'VALUED',
      },
    ],
  });
  expect((await loadPortfolioStation(request, selection, 'valuation'))[0]?.href).toContain(
    '/streams/tank/diesel?',
  );
  expect((await loadPortfolioStation(request, selection, 'valuation'))[0]?.value).toBe(
    '123.4567 L · VALUED',
  );
});
it('retains finance record links and truthful partial failures', async () => {
  mocks.finance.mockResolvedValue({
    items: [{ area: 'Approvals', title: 'Approve', detail: 'One', href: '/record' }],
    unavailable: ['Banking'],
  });
  expect(await loadPortfolioStation(request, selection, 'finance')).toEqual([
    { label: 'Approvals', value: 'Approve — One', href: '/record' },
    { label: 'Banking', value: 'Unavailable' },
  ]);
});
it.each(['operations', 'reconciliations', 'valuation', 'cash', 'settlements', 'finance'] as const)(
  'propagates %s denials to the per-station boundary',
  async (area) => {
    for (const mock of Object.values(mocks)) mock.mockRejectedValue(new Error('denied'));
    await expect(loadPortfolioStation(request, selection, area)).rejects.toThrow('denied');
  },
);
