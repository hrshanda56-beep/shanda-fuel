import type { ChartPoint, DonutSegment } from '@/design-system/charts';
import type { IconName } from '@/design-system/icons';
import type { ShellTask } from '@/design-system/app-shell';

/**
 * SYNTHETIC SAMPLE DATA for the Overview design review (ADR-015).
 *
 * Nothing here is client master data: stations are placeholders ("Station A"),
 * figures are illustrative, and none of it is posted or authoritative. Replace
 * with the reporting projection when it exists; keep the shapes.
 */

export type PeriodKey = 'week' | 'lastweek' | 'month' | 'lastmonth';

export type Kpi = {
  label: string;
  icon: IconName;
  value: string;
  meta: string;
  /** Qualifier shown before the meta line, e.g. "Provisional". */
  qualifier?: string;
};

export type PeriodStats = {
  label: string;
  range: string;
  comparison: string;
  revenue: { total: string; change: string; direction: 'up' | 'down'; points: ChartPoint[] };
  litres: { total: string; change: string; direction: 'up' | 'down'; points: ChartPoint[] };
  labelEvery: number;
};

export type AttentionType = 'exception' | 'approval' | 'info';

export type AttentionRow = {
  id: string;
  priority: 'High' | 'Medium' | 'Low';
  title: string;
  reference: string;
  type: AttentionType;
  typeLabel: string;
  station: string;
  age: string;
};

const WEEKDAYS = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'];

function usd(value: number) {
  return `$${value.toLocaleString('en-US')}`;
}

function litres(value: number) {
  return `${value.toLocaleString('en-US')} L`;
}

function points(
  labels: readonly string[],
  values: readonly number[],
  format: (v: number) => string,
) {
  return values.map((value, index) => ({
    label: labels[index]!,
    value: String(value),
    display: format(value),
  }));
}

/** Deterministic illustrative daily series for month views. */
function wave(length: number, base: number, amplitude: number, seed: number) {
  return Array.from({ length }, (_, index) =>
    Math.round(
      base +
        amplitude * (Math.sin(index * 0.9 + seed) * 0.6 + Math.sin(index * 2.3 + seed * 2) * 0.4) +
        (index / length) * amplitude * 0.5,
    ),
  );
}

function dayLabels(length: number) {
  return Array.from({ length }, (_, index) => String(index + 1));
}

export const sampleContext = {
  organisation: 'Demo organisation',
  station: 'All stations',
  businessDate: 'Tue 29 Sep 2026',
  timeZone: 'CAT',
};

export const sampleTasks: ShellTask[] = [
  { id: 't1', title: 'Approve price change', meta: 'PRC-0088 · due today' },
  { id: 't2', title: 'Sign off dip variance', meta: 'DIP-B-0929 · 5h' },
  { id: 't3', title: 'Approve expense', meta: 'EXP-1193 · 1d' },
];

export const sampleKpis: Kpi[] = [
  { label: 'Fuel revenue', icon: 'dollar', value: '$7,460', meta: 'Yesterday $6,100' },
  {
    label: 'Litres sold',
    icon: 'drop',
    value: '4,640 L',
    meta: 'Diesel 2,770 · Petrol 1,870',
  },
  {
    label: 'Gross margin',
    icon: 'trend',
    value: '$1,070',
    qualifier: 'Provisional',
    meta: '14.3% of revenue',
  },
  { label: 'Cash not banked', icon: 'wallet', value: '$3,180', meta: '4 stations · oldest 2 days' },
];

const monthRevenue = wave(29, 6000, 900, 1);
const lastMonthRevenue = wave(31, 5600, 850, 3);

export const samplePeriods: Record<PeriodKey, PeriodStats> = {
  week: {
    label: 'This week',
    range: 'Wed 23 Sep – Tue 29 Sep 2026',
    comparison: 'vs previous week',
    revenue: {
      total: '$48,210',
      change: '+6.2%',
      direction: 'up',
      points: points(WEEKDAYS, [6200, 6850, 7400, 6900, 7300, 6100, 7460], usd),
    },
    litres: {
      total: '31,840 L',
      change: '+4.1%',
      direction: 'up',
      points: points(WEEKDAYS, [4300, 4650, 4850, 4500, 4750, 4150, 4640], litres),
    },
    labelEvery: 1,
  },
  lastweek: {
    label: 'Last week',
    range: 'Wed 16 Sep – Tue 22 Sep 2026',
    comparison: 'vs the week before',
    revenue: {
      total: '$45,390',
      change: '−1.3%',
      direction: 'down',
      points: points(WEEKDAYS, [6400, 6600, 6900, 6300, 6700, 5900, 6590], usd),
    },
    litres: {
      total: '30,580 L',
      change: '−0.8%',
      direction: 'down',
      points: points(WEEKDAYS, [4350, 4420, 4610, 4200, 4480, 4020, 4500], litres),
    },
    labelEvery: 1,
  },
  month: {
    label: 'This month',
    range: 'Tue 1 Sep – Tue 29 Sep 2026',
    comparison: 'vs August to date',
    revenue: {
      total: '$186,540',
      change: '+3.8%',
      direction: 'up',
      points: points(dayLabels(29), monthRevenue, usd),
    },
    litres: {
      total: '123,300 L',
      change: '+2.6%',
      direction: 'up',
      points: points(
        ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', '29th'],
        [29100, 30400, 31200, 30100, 2500],
        litres,
      ),
    },
    labelEvery: 7,
  },
  lastmonth: {
    label: 'Last month',
    range: 'Sat 1 Aug – Mon 31 Aug 2026',
    comparison: 'vs July',
    revenue: {
      total: '$179,720',
      change: '+1.9%',
      direction: 'up',
      points: points(dayLabels(31), lastMonthRevenue, usd),
    },
    litres: {
      total: '119,850 L',
      change: '+1.2%',
      direction: 'up',
      points: points(
        ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', '29–31'],
        [26800, 27900, 28300, 27600, 9250],
        litres,
      ),
    },
    labelEvery: 7,
  },
};

export const sampleTankStock: {
  segments: DonutSegment[];
  notes: Record<string, { text: string; tone?: 'warning' }>;
} = {
  segments: [
    { label: 'Diesel', value: '36200', display: '36,200 L', series: 1 },
    { label: 'Petrol', value: '22200', display: '22,200 L', series: 3 },
  ],
  notes: {
    Diesel: { text: '13 days cover' },
    Petrol: { text: 'Low at Station C', tone: 'warning' },
  },
};

export const sampleAttention: AttentionRow[] = [
  {
    id: 'r1',
    priority: 'High',
    title: 'Cash short $212.40 at day shift close',
    reference: 'SH-A-0929-D',
    type: 'exception',
    typeLabel: 'Cash variance',
    station: 'Station A',
    age: '2h',
  },
  {
    id: 'r2',
    priority: 'High',
    title: 'Diesel T2 dip differs from book by 1.8%',
    reference: 'DIP-B-0929',
    type: 'exception',
    typeLabel: 'Stock variance',
    station: 'Station B',
    age: '5h',
  },
  {
    id: 'r3',
    priority: 'High',
    title: 'Petrol T1 at 18%, below reorder level',
    reference: 'TNK-C-T1',
    type: 'exception',
    typeLabel: 'Low stock',
    station: 'Station C',
    age: '1h',
  },
  {
    id: 'r4',
    priority: 'Medium',
    title: 'Delivery short 340 L, awaiting supplier',
    reference: 'DLV-0412',
    type: 'exception',
    typeLabel: 'Delivery',
    station: 'Station C',
    age: '1d',
  },
  {
    id: 'r5',
    priority: 'Medium',
    title: 'Petrol price $1.62 → $1.65 to approve',
    reference: 'PRC-0088',
    type: 'approval',
    typeLabel: 'Approval',
    station: 'All',
    age: '3h',
  },
  {
    id: 'r6',
    priority: 'Low',
    title: 'Generator service expense $180.00',
    reference: 'EXP-1193',
    type: 'approval',
    typeLabel: 'Approval',
    station: 'Station D',
    age: '1d',
  },
  {
    id: 'r7',
    priority: 'Low',
    title: 'Day shift not started, due 06:00',
    reference: 'SHF-E-0929-D',
    type: 'info',
    typeLabel: 'Info',
    station: 'Station E',
    age: '40m',
  },
  {
    id: 'r8',
    priority: 'Low',
    title: 'Bank statement for week 39 imported',
    reference: 'BNK-W39',
    type: 'info',
    typeLabel: 'Info',
    station: '—',
    age: '6h',
  },
];

export function maxOf(values: readonly ChartPoint[]) {
  return Math.max(...values.map((point) => Number(point.value)));
}
