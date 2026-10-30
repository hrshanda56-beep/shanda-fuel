import { formatBusinessDate } from '@/design-system/formatters';
import { addDays, isValidDateOnly } from '@/modules/reporting/period';

/**
 * The one period every period figure on the dashboard follows (B1). It is chosen in the page
 * address so the server can read the right records, and it defaults to today. Dates are business
 * dates in the app's business time, never the browser's clock.
 */
export const DASHBOARD_PERIODS = ['today', 'week', 'month', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  custom: 'Custom',
};

export type ResolvedDashboardPeriod = Readonly<{
  period: DashboardPeriod;
  fromDate: string;
  toDate: string;
  /** For a sentence or a label: "today", "this week", "3 Oct 2026 to 9 Oct 2026". */
  phrase: string;
}>;

function isPeriod(value: unknown): value is DashboardPeriod {
  return typeof value === 'string' && (DASHBOARD_PERIODS as readonly string[]).includes(value);
}

/** Monday of the week that contains the date (weeks run Monday to Sunday). */
function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // Sunday is 0
  return addDays(date, -((day + 6) % 7));
}

export function resolveDashboardPeriod(
  raw: { period?: string; fromDate?: string; toDate?: string },
  today: string,
): ResolvedDashboardPeriod {
  const period = isPeriod(raw.period) ? raw.period : 'today';
  if (period === 'week') {
    return { period, fromDate: weekStart(today), toDate: today, phrase: 'this week' };
  }
  if (period === 'month') {
    return { period, fromDate: `${today.slice(0, 7)}-01`, toDate: today, phrase: 'this month' };
  }
  if (period === 'custom') {
    const { fromDate, toDate } = raw;
    if (
      fromDate &&
      toDate &&
      isValidDateOnly(fromDate) &&
      isValidDateOnly(toDate) &&
      fromDate <= toDate
    ) {
      const end = toDate > today ? today : toDate;
      if (fromDate <= end) {
        return {
          period,
          fromDate,
          toDate: end,
          phrase: `${formatBusinessDate(fromDate)} to ${formatBusinessDate(end)}`,
        };
      }
    }
  }
  return { period: 'today', fromDate: today, toDate: today, phrase: 'today' };
}

/** For a figure that is a position at this moment rather than a total over the period. */
export function asAtLabel(now: Date): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Harare',
  }).format(now);
  return `As at ${time}`;
}
