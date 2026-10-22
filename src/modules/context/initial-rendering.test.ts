import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => unknown) => {
    effects.push(effect);
  },
}));
beforeEach(() => {
  effects.length = 0;
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  // Execute the real mount-effect closures against server-supplied initial data.
  // A repeated initial fetch would call the stub or require browser-only globals.
  for (const effect of effects) effect();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
import type { ContextResolution } from './contracts';
vi.mock('next/navigation', () => ({
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
import { CustomerWorkspace } from '../customers/ui/customer-workspace';
import { CustomerDetailWorkspace } from '../customers/ui/customer-detail-workspace';
import { SupplierWorkspace } from '../creditors/ui/supplier-workspace';
import { SupplierDetailWorkspace } from '../creditors/ui/supplier-detail-workspace';
import { SettlementWorkspace } from '../settlements/ui/settlement-workspace';
import { CashWorkspace, type CashSummary } from '../cash/ui/cash-workspace';
import { ValuationOverview } from '../costing/ui/valuation-workspace';
const current = {
  organisationId: 'tenant',
  legalEntityId: 'entity',
  stationId: 'station',
  allStations: false,
};
const resolution: ContextResolution = {
  current,
  persistedContextInvalid: false,
  available: {
    organisations: [
      {
        id: 'tenant',
        name: 'Test organisation',
        legalEntities: [
          {
            id: 'entity',
            name: 'Test entity',
            stations: [
              { id: 'station', name: 'Test station', code: 'TST', timezone: 'Africa/Harare' },
            ],
          },
        ],
      },
    ],
  },
  route: {
    pathname: '/customers',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
  },
};
it('renders customer list data during server rendering', () => {
  const html = renderToStaticMarkup(
    createElement(CustomerWorkspace, { initial: { resolution, customers: [] } }),
  );
  expect(html).not.toContain('Loading customers');
  expect(html).not.toContain('Checking work context');
  expect(html).toContain('No customers');
});
it('renders customer not-found state without a client request', () => {
  const html = renderToStaticMarkup(
    createElement(CustomerDetailWorkspace, {
      customerId: 'missing',
      initial: { resolution, customer: null },
    }),
  );
  expect(html).toContain('We could not find this customer');
});
it('renders supplier list data during server rendering', () => {
  const html = renderToStaticMarkup(
    createElement(SupplierWorkspace, { initial: { resolution, rows: [] } }),
  );
  expect(html).toContain('No suppliers');
  expect(html).not.toContain('Loading suppliers');
});
it('renders supplier not-found state without a client request', () => {
  const html = renderToStaticMarkup(
    createElement(SupplierDetailWorkspace, {
      supplierId: 'missing',
      initial: { resolution, supplier: null, statement: [] },
    }),
  );
  expect(html).toContain('not found');
});
it('renders settlement data instead of its loading state', () => {
  const html = renderToStaticMarkup(
    createElement(SettlementWorkspace, {
      stationId: 'station',
      initial: {
        context: { ...current, canonicalHref: '/stations/station/settlements' },
        settlements: [],
        unmatched: [],
      },
    }),
  );
  expect(html).not.toContain('Loading settlements');
  expect(html).not.toContain('Loading payouts');
  expect(html).not.toContain('Loading provider payouts');
  expect(html).toContain('No provider payouts yet');
});
it('renders cash data instead of its loading state', () => {
  const summary: CashSummary = {
    handovers: [],
    currentMembershipId: 'me',
    stationId: 'station',
    currency: 'USD',
    totals: { availableAtStation: '0', collectedButUnbanked: '0', pendingBankConfirmation: '0' },
    collections: [],
    locations: [],
    reconciliationSources: [],
    bankAccounts: [],
    deposits: [],
    capabilities: {
      viewDeposits: false,
      recordCollection: false,
      receiveCollection: false,
      recordDeposit: false,
      confirmDeposit: false,
      submitHandover: false,
      acceptHandover: false,
      resolveHandover: false,
    },
  };
  const html = renderToStaticMarkup(
    createElement(CashWorkspace, { initial: { selection: current, summary } }),
  );
  expect(html).not.toContain('Loading collections');
  expect(html).toContain('No collections');
});
it('renders valuation and tank data together without a loading stream', () => {
  const html = renderToStaticMarkup(
    createElement(ValuationOverview, {
      context: {
        tenantId: 'tenant',
        legalEntityId: 'entity',
        stationId: 'station',
        organisationName: 'Test organisation',
        legalEntityName: 'Test entity',
        stationName: 'Test station',
        stationTimezone: 'Africa/Harare',
      },
      contextHref: '/inventory/valuation',
      initialData: {
        capabilities: { request: false, approve: false, post: false },
        streams: [],
        revaluations: [],
        tankReport: { filters: { toDate: '2026-10-18' }, inventory: { rows: [] } },
      },
    }),
  );
  expect(html).not.toContain('Loading valuation streams');
  expect(html).toContain('Tanks');
});

vi.mock('@clerk/nextjs', () => ({ useReverification: (work: unknown) => work }));
import { OperationsControlRoom } from '../forecourt/ui/operations-control-room';
import { DailyOperationsWorkspace } from '../forecourt/ui/daily-operations-workspace';
import { MyShiftWorkspace } from '../forecourt/ui/my-shift-workspace';
import { TodayOverview } from '@/app/_overview/today-overview';
it('renders Operations overview without fetching it again on mount', () => {
  const action = { canExecute: false, permissionGranted: false, requiresStepUp: false };
  const html = renderToStaticMarkup(
    createElement(OperationsControlRoom, {
      context: { tenantId: 'tenant', stationId: 'station' },
      initialData: {
        station: { code: 'TST', name: 'Test station', timezone: 'Africa/Harare' },
        organisation: { name: 'Test organisation' },
        currentBusinessDate: '2026-10-18',
        currentBusinessDayId: null,
        visibility: { reconciliations: false },
        actions: {
          OpenBusinessDay: action,
          CloseBusinessDay: action,
          LockBusinessDay: action,
          StartShift: action,
          CloseMeters: action,
          CompleteShift: action,
        },
        businessDays: [],
        shifts: [],
        reconciliations: [],
      },
    }),
  );
  expect(html).not.toContain('Loading operations');
  expect(html).toContain('Test station');
});
it('renders an initial daily draft and skips all initial summary fetches', () => {
  const html = renderToStaticMarkup(
    createElement(DailyOperationsWorkspace, {
      context: { tenantId: 'tenant', stationId: 'station', businessDayId: 'day', shiftId: 'shift' },
      initialData: {
        operation: {
          station: { id: 'station', code: 'TST', name: 'Test station', timezone: 'Africa/Harare' },
          organisation: { id: 'tenant', name: 'Test organisation' },
          businessDay: { id: 'day', date: '2026-10-18', state: 'OPEN', version: 1 },
          shift: {
            id: 'shift',
            state: 'OPEN',
            businessDate: '2026-10-18',
            plannedStartAt: '2026-10-18T06:00:00Z',
            plannedEndAt: '2026-10-18T18:00:00Z',
            version: 1,
          },
          attendants: [],
          availableReadings: [],
        },
        record: null,
        settlements: [],
      },
    }),
  );
  expect(html).not.toContain('Loading daily operations');
  expect(html).toContain('Test station');
});
it('renders the attendant result without re-fetching on mount', () => {
  const html = renderToStaticMarkup(
    createElement(MyShiftWorkspace, {
      tenantId: 'tenant',
      stationId: 'station',
      initialData: {
        station: { id: 'station', name: 'Test station', timezone: 'Africa/Harare' },
        tenantId: 'tenant',
        legalEntityId: 'entity',
        now: '2026-10-18T12:00:00Z',
        responsibleAttendantId: 'attendant',
        canCapture: false,
        shift: null,
        meters: [],
      },
    }),
  );
  expect(html).toContain('Test station');
  expect(html).not.toContain('Loading your shift');
});
it('renders initial dashboard sections without requesting the bundle or chart again', () => {
  const html = renderToStaticMarkup(
    createElement(TodayOverview, {
      tenantId: 'tenant',
      stationId: 'station',
      initialData: {
        key: 'tenant|station|30D',
        daily: { status: 'ready', data: { rows: [] } },
        customers: { status: 'ready', data: { customers: [] } },
        operations: null,
        chart: { status: 'ready', data: { sales: { rows: [] } } },
      },
    }),
  );
  expect(html).toContain('No approved report yet');
});

it('does not wait for station operations in an all-stations dashboard', () => {
  const html = renderToStaticMarkup(
    createElement(TodayOverview, {
      tenantId: 'tenant',
      initialData: {
        key: 'tenant||30D',
        daily: { status: 'ready', data: { rows: [] } },
        customers: { status: 'ready', data: { customers: [] } },
        operations: null,
        chart: { status: 'ready', data: { sales: { rows: [] } } },
      },
    }),
  );
  expect(html).not.toContain('Checking for items that need attention');
  expect(html).toContain('Choose a station');
});
