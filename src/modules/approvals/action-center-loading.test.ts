import { AppError } from '../../platform/errors';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  cash: vi.fn(),
  settlements: vi.fn(),
  unmatched: vi.fn(),
  suppliers: vi.fn(),
  customers: vi.fn(async () => ({ customers: [] })),
}));
vi.mock('../inventory/application', () => ({ withInventoryReadContext: mocks.sign }));
vi.mock('../cash/queries', () => ({ getCashStationSummaryFromRequest: mocks.cash }));
vi.mock('../settlements/queries', () => ({
  getSettlementOverviewFromRequest: async (...args: unknown[]) => ({
    settlements: await mocks.settlements(...args),
    unmatched: await mocks.unmatched(...args),
  }),
}));
vi.mock('../customers/queries', () => ({
  getCustomerAccountsFromRequest: mocks.customers,
}));
vi.mock('../creditors/queries', () => ({ getSupplierSummaryFromRequest: mocks.suppliers }));
import { loadActionCenterFacts } from './action-center';
import { withRequestReadScope } from '../../platform/security/request-read-scope';
afterEach(() => vi.clearAllMocks());
it('starts independent finance sections before waiting for sign-off', async () => {
  let release!: () => void;
  let readContexts = 0;
  mocks.sign.mockImplementation(() => {
    readContexts += 1;
    // The second read is the operations facts: they never wait for sign-off.
    if (readContexts === 2)
      return Promise.resolve({ today: '2026-10-21', reports: null, tanks: null });
    // The third read is the extra alert facts, which also never wait for sign-off.
    if (readContexts === 3) return Promise.resolve({ today: '2026-10-21' });
    return new Promise((resolve) => {
      release = () => resolve({ reconciliations: null, revaluations: null });
    });
  });
  mocks.cash.mockResolvedValue({
    totals: { collectedButUnbanked: '0', pendingBankConfirmation: '0' },
  });
  mocks.settlements.mockResolvedValue([]);
  mocks.unmatched.mockResolvedValue([]);
  mocks.suppliers.mockResolvedValue([]);
  const pending = loadActionCenterFacts(
    new Request('http://localhost/finance'),
    {
      organisationId: '11111111-1111-4111-8111-111111111111',
      stationId: '22222222-2222-4222-8222-222222222222',
      legalEntityId: '33333333-3333-4333-8333-333333333333',
      allStations: false,
    },
    {
      identityId: '44444444-4444-4444-8444-444444444444',
      session: {
        sessionId: 'session',
        userId: '44444444-4444-4444-8444-444444444444',
        expiresAt: new Date('2099-01-01'),
      },
    },
  );
  try {
    expect(mocks.cash).toHaveBeenCalledTimes(1);
    expect(mocks.settlements).toHaveBeenCalledTimes(1);
    // Suppliers wait only for the quick operations read (it carries the saved reminder days),
    // never for sign-off, which is still pending here.
    await vi.waitFor(() => expect(mocks.suppliers).toHaveBeenCalledTimes(1));
  } finally {
    release();
    await pending;
  }
});

it('preserves restricted-section behavior while other finance sections succeed', async () => {
  mocks.sign.mockResolvedValue({ reconciliations: null, revaluations: null });
  mocks.cash.mockRejectedValue(new AppError('FORBIDDEN', 'Restricted'));
  mocks.settlements.mockResolvedValue([]);
  mocks.unmatched.mockResolvedValue([]);
  mocks.suppliers.mockResolvedValue([]);
  const result = await loadActionCenterFacts(
    new Request('http://localhost/finance'),
    {
      organisationId: '11111111-1111-4111-8111-111111111111',
      stationId: '22222222-2222-4222-8222-222222222222',
      legalEntityId: '33333333-3333-4333-8333-333333333333',
      allStations: false,
    },
    {
      identityId: '44444444-4444-4444-8444-444444444444',
      session: {
        sessionId: 'session',
        userId: '44444444-4444-4444-8444-444444444444',
        expiresAt: new Date('2099-01-01'),
      },
    },
  );
  expect(result.cash.status).toBe('restricted');
  expect(result.settlements.status).toBe('ok');
  expect(result.suppliers.status).toBe('ok');
});

const tenant = '11111111-1111-4111-8111-111111111111';
const entity = '33333333-3333-4333-8333-333333333333';
const actorFor = (id: string) => ({
  identityId: id,
  session: { sessionId: 'session', userId: id, expiresAt: new Date('2099-01-01') },
});
const stationFor = (stationId: string) => ({
  organisationId: tenant,
  stationId,
  legalEntityId: entity,
  allStations: false as const,
});
const stationA = '22222222-2222-4222-8222-222222222222';
const stationB = '55555555-5555-4555-8555-555555555555';
const personA = '44444444-4444-4444-8444-444444444444';
const personB = '66666666-6666-4666-8666-666666666666';

function quietDefaults() {
  mocks.sign.mockResolvedValue({ reconciliations: null, revaluations: null });
  mocks.cash.mockResolvedValue({
    totals: { collectedButUnbanked: '0', pendingBankConfirmation: '0' },
  });
  mocks.settlements.mockResolvedValue([]);
  mocks.unmatched.mockResolvedValue([]);
  mocks.suppliers.mockResolvedValue([]);
}

it('reads the company customer accounts once when one request looks at several stations', async () => {
  quietDefaults();
  const request = new Request('http://localhost/');
  await withRequestReadScope(() =>
    Promise.all([
      loadActionCenterFacts(request, stationFor(stationA), actorFor(personA)),
      loadActionCenterFacts(request, stationFor(stationB), actorFor(personA)),
    ]),
  );
  expect(mocks.customers).toHaveBeenCalledTimes(1);
  // The station-specific reads are still made for every station.
  expect(mocks.cash).toHaveBeenCalledTimes(2);
  expect(mocks.settlements).toHaveBeenCalledTimes(2);
});

it('never shares the customer read between two people in the same scope', async () => {
  quietDefaults();
  const request = new Request('http://localhost/');
  await withRequestReadScope(() =>
    Promise.all([
      loadActionCenterFacts(request, stationFor(stationA), actorFor(personA)),
      loadActionCenterFacts(request, stationFor(stationA), actorFor(personB)),
    ]),
  );
  expect(mocks.customers).toHaveBeenCalledTimes(2);
});

it('does not carry the customer read from one separate request into the next', async () => {
  quietDefaults();
  const request = new Request('http://localhost/');
  await loadActionCenterFacts(request, stationFor(stationA), actorFor(personA));
  await loadActionCenterFacts(request, stationFor(stationA), actorFor(personA));
  expect(mocks.customers).toHaveBeenCalledTimes(2);
});
