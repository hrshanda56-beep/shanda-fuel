/**
 * Report periods: the presets a user can pick for a report, resolved to the
 * inclusive `fromDate`/`toDate` range the reporting queries take.
 *
 * Pure date arithmetic on YYYY-MM-DD strings; "today" is always passed in so the
 * result never depends on the server or browser clock.
 */

export const REPORT_PERIODS = ['this-month', 'last-month', '3m', '6m', '12m', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  custom: 'Custom range',
};

export const DEFAULT_REPORT_PERIOD: ReportPeriod = 'this-month';

export type ResolvedPeriod = { period: ReportPeriod; fromDate: string; toDate: string };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (REPORT_PERIODS as readonly string[]).includes(value);
}

export function isValidDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parts(date: string): [number, number, number] {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function format(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Same day-of-month `months` earlier, clamped to the end of a shorter month. */
export function subtractMonths(date: string, months: number): string {
  const [year, month, day] = parts(date);
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return format(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  return format(year, month, day + days);
}

/**
 * Resolves a period to an inclusive range. Rolling periods ("last 3 months") run
 * from the day after the same date N months ago up to and including today.
 * Returns null for an incomplete or inverted custom range.
 */
export function resolvePeriod(
  period: ReportPeriod,
  today: string,
  custom?: { fromDate?: string | null; toDate?: string | null },
): ResolvedPeriod | null {
  const [year, month] = parts(today);
  switch (period) {
    case 'this-month':
      return { period, fromDate: format(year, month, 1), toDate: today };
    case 'last-month': {
      const first = subtractMonths(format(year, month, 1), 1);
      const [lastYear, lastMonth] = parts(first);
      return {
        period,
        fromDate: first,
        toDate: format(lastYear, lastMonth, daysInMonth(lastYear, lastMonth)),
      };
    }
    case '3m':
    case '6m':
    case '12m': {
      const months = Number.parseInt(period, 10);
      return { period, fromDate: addDays(subtractMonths(today, months), 1), toDate: today };
    }
    case 'custom': {
      const { fromDate, toDate } = custom ?? {};
      if (!fromDate || !toDate || !isValidDateOnly(fromDate) || !isValidDateOnly(toDate))
        return null;
      if (fromDate > toDate) return null;
      return { period, fromDate, toDate };
    }
  }
}

/** Zimbabwe (Africa/Harare, UTC+2, no DST) calendar date for an instant. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(now);
}
