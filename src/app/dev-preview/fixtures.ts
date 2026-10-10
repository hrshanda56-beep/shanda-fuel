import type { ContextResolution } from '@/modules/context';

export const SCENARIOS = ['normal', 'attention', 'empty', 'loading', 'error'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const TENANT = '00000000-0000-4000-8000-000000000001';
const ENTITY = '00000000-0000-4000-8000-000000000002';
const STATION = '00000000-0000-4000-8000-000000000003';
const STATION_2 = '00000000-0000-4000-8000-000000000004';

const available = {
  organisations: [
    {
      id: TENANT,
      name: 'Shanda Fuel (preview)',
      legalEntities: [
        {
          id: ENTITY,
          name: 'Shanda Energy Ltd',
          stations: [
            { id: STATION, code: 'HRE', name: 'Harare Central', timezone: 'Africa/Harare' },
            { id: STATION_2, code: 'BYO', name: 'Bulawayo Road', timezone: 'Africa/Harare' },
          ],
        },
      ],
    },
  ],
};

function context(scenario: Scenario, pathname: string): ContextResolution {
  return {
    available,
    current:
      scenario === 'empty'
        ? null
        : { organisationId: TENANT, legalEntityId: ENTITY, stationId: STATION, allStations: false },
    route: {
      pathname,
      policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
    },
    persistedContextInvalid: false,
  };
}

const operations = (scenario: Scenario) => ({
  station: { name: 'Harare Central' },
  currentBusinessDate: new Date().toISOString().slice(0, 10),
  status: {
    close: scenario === 'attention' ? 'READY_FOR_REVIEW' : 'IN_PROGRESS',
    approval: scenario === 'attention' ? 'PENDING_APPROVAL' : 'DRAFT',
  },
  shifts: [
    { id: 's1', state: 'OPEN' },
    { id: 's2', state: 'OPEN' },
    { id: 's3', state: 'CLOSED' },
  ],
});

const customers = (scenario: Scenario) => ({
  customers: [
    ...Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, status: 'ACTIVE' })),
    ...(scenario === 'attention'
      ? [
          { id: 'x1', status: 'SUSPENDED' },
          { id: 'x2', status: 'SUSPENDED' },
        ]
      : []),
  ],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function readScenario(): Scenario {
  const value = new URLSearchParams(window.location.search).get('scenario');
  return (SCENARIOS as readonly string[]).includes(value ?? '') ? (value as Scenario) : 'normal';
}

/** Answers the few /api reads a screen makes with fixtures. Everything else passes through. */
export function installFixtureFetch() {
  const marker = '__shandaFixtureFetch';
  const w = window as unknown as Record<string, unknown>;
  if (w[marker]) return;
  w[marker] = true;
  const real = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    const path = url.pathname;
    const scenario = readScenario();
    const mocked =
      path === '/api/context' ||
      path === '/api/forecourt/operations/overview' ||
      path === '/api/customers/summary';
    if (!mocked) return real(input, init);

    if (scenario === 'loading') return new Promise<Response>(() => {});
    if (scenario === 'error' && path !== '/api/context') {
      return json({ message: 'Preview: simulated server error.' }, 500);
    }
    if (path === '/api/context') {
      return json({ data: context(scenario, url.searchParams.get('pathname') ?? '/') });
    }
    if (path === '/api/forecourt/operations/overview') return json(operations(scenario));
    return json(customers(scenario));
  };
}
