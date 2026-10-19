import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ContextResolution } from './contracts';
const mocks = vi.hoisted(() => ({ load: vi.fn(), suppliers: vi.fn() }));
vi.mock('./portfolio-data', () => ({ loadPortfolioStation: mocks.load }));
vi.mock('@/modules/creditors/queries', () => ({ getSupplierSummaryFromRequest: mocks.suppliers }));
vi.mock('@/modules/tenancy/request-authority', () => ({
  withRequestAuthority: (load: () => unknown) => load(),
}));
import { PortfolioOverview, SupplierPortfolio } from './portfolio-overview';
import { AppError } from '@/platform/errors';
const resolution: ContextResolution = {
  current: { organisationId: 'tenant', allStations: true },
  available: {
    organisations: [
      {
        id: 'tenant',
        name: 'Owner',
        legalEntities: [
          {
            id: 'entity',
            name: 'Entity',
            stations: [
              { id: 's1', name: 'Alpha', code: 'A', timezone: 'UTC' },
              { id: 's2', name: 'Bravo', code: 'B', timezone: 'UTC' },
            ],
          },
        ],
      },
    ],
  },
  route: {
    pathname: '/cash',
    policy: { station: 'optional', legalEntity: 'optional', allStationsAllowed: true },
  },
  persistedContextInvalid: false,
};
const request = new Request('http://localhost');
async function html(node: ReturnType<typeof createElement>) {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}
beforeEach(() => vi.resetAllMocks());
it('streams station facts on the server with working station links', async () => {
  mocks.load.mockResolvedValue([{ label: 'Cash', value: 'USD 12.3456' }]);
  const output = await html(
    createElement(PortfolioOverview, { request, resolution, area: 'cash' }),
  );
  expect(output).toContain('USD 12.3456');
  expect(output).toContain('/stations/s1/cash?');
  expect(output).toContain('/stations/s2/cash?');
  expect(mocks.load).toHaveBeenCalledTimes(2);
});
it('does not expose failed or unauthorized station data and preserves other results', async () => {
  mocks.load.mockImplementation((_request, selection) =>
    selection.stationId === 's1'
      ? Promise.reject(new AppError('FORBIDDEN', 'private SQL'))
      : Promise.resolve([{ label: 'Cash', value: 'USD 5' }]),
  );
  const output = await html(
    createElement(PortfolioOverview, { request, resolution, area: 'cash' }),
  );
  expect(output).toContain('USD 5');
  expect(output).not.toContain('private SQL');
});
it('renders a truthful empty state without querying stations outside the authorized tree', async () => {
  const output = await html(
    createElement(PortfolioOverview, {
      request,
      resolution: { ...resolution, available: { organisations: [] } },
      area: 'operations',
    }),
  );
  expect(output).toContain('No stations available');
  expect(mocks.load).not.toHaveBeenCalled();
});
it('loads supplier balances only once per entity rather than once per station', async () => {
  mocks.suppliers.mockResolvedValue([
    { supplierId: 'supplier', legalName: 'Fuel Supplier', currency: 'USD', total: '1234.5678' },
  ]);
  const output = await html(createElement(SupplierPortfolio, { request, resolution }));
  expect(mocks.suppliers).toHaveBeenCalledTimes(1);
  expect(output).toContain('1234.5678');
  expect(output).toContain('legalEntityId=entity');
});
it('keeps a supplier failure truthful and does not expose diagnostic details', async () => {
  mocks.suppliers.mockRejectedValue(new Error('secret database details'));
  const output = await html(createElement(SupplierPortfolio, { request, resolution }));
  expect(output).toContain('Supplier data unavailable');
  expect(output).not.toContain('secret database details');
});
