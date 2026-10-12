import type { MyShiftData, MyShiftMeter } from '@/modules/forecourt/my-shift-state';

/**
 * Preview-only data for the My Shift screen. Each scenario is a plain
 * `MyShiftData` payload (or a failure status); the real component derives
 * everything else, so nothing here duplicates product logic.
 */
export type ScenarioResult = { status: 200; body: MyShiftData } | { status: 403 | 500 | 'hang' };

export type Scenario = {
  id: string;
  title: string;
  note: string;
  build: (now: number) => ScenarioResult;
};

const T = '00000000-0000-4000-8000-000000000001';
const E = '00000000-0000-4000-8000-000000000002';
const S = '00000000-0000-4000-8000-000000000003';
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

type Opts = {
  stationName?: string;
  timezone?: string;
  label?: string | null;
  state?: string;
  start?: number;
  end?: number;
  canCapture?: boolean;
  meters?: MyShiftMeter[];
  noShift?: boolean;
};

function data(now: number, o: Opts = {}): MyShiftData {
  return {
    station: {
      id: S,
      name: o.stationName ?? 'Harare Central',
      timezone: o.timezone ?? 'Africa/Harare',
    },
    tenantId: T,
    legalEntityId: E,
    now: iso(now),
    responsibleAttendantId: '256129bb-ea7c-467d-adad-7dce26b64e09',
    canCapture: o.canCapture ?? true,
    shift: o.noShift
      ? null
      : {
          id: 'shift-1',
          businessDayId: 'day-1',
          label: o.label === undefined ? 'Day shift' : o.label,
          state: o.state ?? 'OPEN',
          businessDayState: 'OPEN',
          plannedStartAt: iso(o.start ?? now - 3 * HOUR),
          plannedEndAt: iso(o.end ?? now + 5 * HOUR),
          version: 2,
        },
    meters: o.meters ?? baseMeters(now),
  };
}

const recorded = (value: string, at: number) => ({
  status: 'RECORDED' as const,
  value,
  recordedAt: iso(at),
});

function meter(n: number, over: Partial<MyShiftMeter> = {}): MyShiftMeter {
  return {
    nozzleId: `nozzle-${n}`,
    meterInstallationId: `install-${n}`,
    pumpNumber: String(Math.ceil(n / 2)),
    nozzleNumber: String(((n - 1) % 2) + 1),
    productName: n % 2 ? 'Diesel' : 'Unleaded 95',
    previousReading: '1000.000',
    opening: null,
    closing: null,
    ...over,
  };
}

function baseMeters(now: number): MyShiftMeter[] {
  return [
    meter(1, { opening: recorded('1000.000', now - 3 * HOUR) }),
    meter(2, { previousReading: '5400.500' }),
  ];
}

const LONG_STATION =
  'Harare Central Forecourt and Convenience Complex (Samora Machel Avenue & Julius Nyerere Way Branch)';

export const SCENARIOS: Scenario[] = [
  {
    id: 'normal',
    title: 'Normal',
    note: 'Two nozzles, one opening reading done, one due.',
    build: (now) => ({ status: 200, body: data(now) }),
  },
  {
    id: 'long-names',
    title: 'Very long names',
    note: 'Long station, shift and product names with long meter labels.',
    build: (now) => ({
      status: 200,
      body: data(now, {
        stationName: LONG_STATION,
        label: 'Extended public-holiday trading shift (Heroes Day weekend cover)',
        meters: [
          meter(1, {
            productName: 'Unleaded 95 Premium Ethanol-Blend Super Low-Sulphur Performance Fuel',
            opening: recorded('1000.000', now - 3 * HOUR),
          }),
          meter(2, { productName: 'Ultra Low Sulphur Diesel 50ppm Commercial Fleet Grade' }),
          meter(3, { pumpNumber: '12B', nozzleNumber: '4A', productName: 'LPG' }),
        ],
      }),
    }),
  },
  {
    id: 'many-meters',
    title: '56 nozzles',
    note: 'A large forecourt: 56 meters in mixed states.',
    build: (now) => ({
      status: 200,
      body: data(now, {
        meters: Array.from({ length: 56 }, (_, i) => {
          const n = i + 1;
          return meter(n, {
            previousReading: `${1000 + n * 137}.250`,
            opening: n % 3 === 0 ? null : recorded(`${1000 + n * 137}.250`, now - 3 * HOUR),
          });
        }),
      }),
    }),
  },
  {
    id: 'one-meter',
    title: 'One nozzle',
    note: 'A single meter, opening due.',
    build: (now) => ({
      status: 200,
      body: data(now, { meters: [meter(1, { previousReading: '250.000' })] }),
    }),
  },
  {
    id: 'no-meters',
    title: 'No meters set up',
    note: 'A running shift at a station with no meters.',
    build: (now) => ({ status: 200, body: data(now, { meters: [] }) }),
  },
  {
    id: 'no-shift',
    title: 'No shift',
    note: 'Empty state: nothing scheduled.',
    build: (now) => ({ status: 200, body: data(now, { noShift: true, meters: [] }) }),
  },
  {
    id: 'not-started',
    title: 'Shift not started',
    note: 'Planned shift waiting for the supervisor.',
    build: (now) => ({
      status: 200,
      body: data(now, {
        state: 'PLANNED',
        start: now + HOUR,
        end: now + 9 * HOUR,
        label: 'Night shift',
      }),
    }),
  },
  {
    id: 'closing-due',
    title: 'Closing due',
    note: 'Shift end has passed; closing readings are due.',
    build: (now) => ({
      status: 200,
      body: data(now, {
        start: now - 9 * HOUR,
        end: now - 10 * 60_000,
        meters: [
          meter(1, { opening: recorded('1000.000', now - 9 * HOUR) }),
          meter(2, {
            opening: recorded('5400.500', now - 9 * HOUR),
            closing: recorded('5812.750', now - 60_000),
          }),
        ],
      }),
    }),
  },
  {
    id: 'finished',
    title: 'Shift finished',
    note: 'All readings recorded.',
    build: (now) => ({
      status: 200,
      body: data(now, {
        state: 'COMPLETED',
        start: now - 10 * HOUR,
        end: now - HOUR,
        meters: [
          meter(1, {
            opening: recorded('1000.000', now - 10 * HOUR),
            closing: recorded('1480.125', now - HOUR),
          }),
          meter(2, {
            opening: recorded('5400.500', now - 10 * HOUR),
            closing: recorded('5812.750', now - HOUR),
          }),
        ],
      }),
    }),
  },
  {
    id: 'big-readings',
    title: 'Huge meter readings',
    note: 'Twelve-digit readings, all-zero readings and awkward time zone (+08:45).',
    build: (now) => ({
      status: 200,
      body: data(now, {
        timezone: 'Australia/Eucla',
        start: Date.UTC(2026, 11, 31, 22, 15),
        end: Date.UTC(2027, 0, 1, 7, 45),
        meters: [
          meter(1, {
            previousReading: '999999999999.999',
            opening: recorded('999999999999.999', now - 3 * HOUR),
          }),
          meter(2, { previousReading: '0.000', opening: recorded('0.000', now - 3 * HOUR) }),
          meter(3, { previousReading: '123456789012.500' }),
        ],
      }),
    }),
  },
  {
    id: 'problems',
    title: 'Needs a supervisor',
    note: 'Unreadable meter, no installed meter and an unrecorded boundary.',
    build: (now) => ({
      status: 200,
      body: data(now, {
        meters: [
          meter(1, { opening: { status: 'UNAVAILABLE', recordedAt: iso(now - 3 * HOUR) } }),
          meter(2, { meterInstallationId: null }),
          meter(3, { opening: recorded('1000.000', now - 3 * HOUR) }),
        ],
      }),
    }),
  },
  {
    id: 'view-only',
    title: 'View only',
    note: 'The attendant can see the shift but not record readings.',
    build: (now) => ({ status: 200, body: data(now, { canCapture: false }) }),
  },
  {
    id: 'new-meter',
    title: 'Brand-new meter',
    note: 'No earlier reading, so the opening form asks for a reason.',
    build: (now) => ({
      status: 200,
      body: data(now, { meters: [meter(1, { previousReading: null })] }),
    }),
  },
  {
    id: 'loading',
    title: 'Loading',
    note: 'The request never answers (skeleton).',
    build: () => ({ status: 'hang' }),
  },
  {
    id: 'error',
    title: 'Error',
    note: 'The server fails (error state with retry).',
    build: () => ({ status: 500 }),
  },
  { id: 'forbidden', title: 'Forbidden', note: 'Access refused.', build: () => ({ status: 403 }) },
];

export const SCENARIO_COOKIE = 'demo_scenario';
export const findScenario = (id: string | undefined) =>
  SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
