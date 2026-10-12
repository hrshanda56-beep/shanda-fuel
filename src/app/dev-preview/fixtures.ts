import type { ContextResolution } from '@/modules/context';
import { businessToday } from '@/modules/reporting/period';

import {
  isPreviewRuntime,
  previewDailyReport,
  previewManagementSales,
  type PreviewReportScenario,
} from './preview-reports';

export const SCENARIOS = [
  'normal',
  'attention',
  'unapproved',
  'empty',
  'loading',
  'error',
] as const;
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

const REPORT_PATHS = ['/api/reports/daily', '/api/reports/management'];
const MOCKED_PATHS = [
  '/api/context',
  '/api/forecourt/operations/overview',
  '/api/customers/summary',
  ...REPORT_PATHS,
];

export type FixtureAnswer = { status: number; body: unknown } | 'hang' | null;

function reportScenario(scenario: Scenario): PreviewReportScenario {
  return scenario === 'attention' || scenario === 'unapproved' ? scenario : 'normal';
}

/**
 * The preview's answer for one request, or null to let the request through.
 * Returns null for everything outside development/test, so sample data can
 * never reach a built app even if this code were somehow loaded there.
 */
export function fixtureAnswer(
  url: URL,
  scenario: Scenario,
  // Required, never defaulted: an explicit undefined must also be refused.
  nodeEnv: string | undefined,
  today: string = businessToday(),
): FixtureAnswer {
  if (!isPreviewRuntime(nodeEnv)) return null;
  const path = url.pathname;
  if (!MOCKED_PATHS.includes(path)) return null;
  if (scenario === 'loading') return 'hang';
  if (scenario === 'error' && path !== '/api/context') {
    return { status: 500, body: { message: 'Preview: simulated server error.' } };
  }
  if (path === '/api/context') {
    return {
      status: 200,
      body: { data: context(scenario, url.searchParams.get('pathname') ?? '/') },
    };
  }
  if (path === '/api/forecourt/operations/overview') {
    return { status: 200, body: operations(scenario) };
  }
  if (path === '/api/customers/summary') return { status: 200, body: customers(scenario) };
  const stationId = url.searchParams.get('stationIds') ?? STATION;
  const stationCode = stationId === STATION_2 ? 'BYO' : 'HRE';
  if (path === '/api/reports/daily') {
    return {
      status: 200,
      body: previewDailyReport(reportScenario(scenario), stationId, stationCode, today),
    };
  }
  const toDate = url.searchParams.get('toDate') ?? today;
  const fromDate = url.searchParams.get('fromDate') ?? toDate;
  return {
    status: 200,
    body: previewManagementSales(
      reportScenario(scenario),
      stationId,
      stationCode,
      fromDate,
      toDate,
    ),
  };
}

function readScenario(): Scenario {
  const value = new URLSearchParams(window.location.search).get('scenario');
  return (SCENARIOS as readonly string[]).includes(value ?? '') ? (value as Scenario) : 'normal';
}

/** Answers the few /api reads a screen makes with fixtures. Everything else passes through. */
export function installFixtureFetch() {
  if (!isPreviewRuntime(process.env.NODE_ENV)) return;
  const marker = '__shandaFixtureFetch';
  const w = window as unknown as Record<string, unknown>;
  if (w[marker]) return;
  w[marker] = true;
  const real = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const answer = fixtureAnswer(
      new URL(raw, window.location.origin),
      readScenario(),
      process.env.NODE_ENV,
    );
    if (answer === null) return real(input, init);
    if (answer === 'hang') return new Promise<Response>(() => {});
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
