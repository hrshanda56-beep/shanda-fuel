/**
 * Rules for recording a business day after the day itself ("past-day entry").
 * Pure functions: dates are station-local `YYYY-MM-DD` strings, never instants, so the
 * result does not depend on the machine's clock or time zone.
 */

/** How far back anyone may record a day. */
export const PAST_DAY_WINDOW_DAYS = 90;
/** How far back a supervisor may record a day without owner-level permission. */
export const PAST_DAY_SUPERVISOR_DAYS = 7;

export type PastDayRefusal =
  | { code: 'BAD_DATE'; message: string }
  | { code: 'NOT_IN_THE_PAST'; message: string }
  | { code: 'BEFORE_GO_LIVE'; message: string }
  | { code: 'TOO_FAR_BACK'; message: string }
  | { code: 'NEEDS_OWNER'; message: string }
  | { code: 'ALREADY_EXISTS'; message: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); null if either is not a real date. */
export function daysBetween(from: string, to: string): number | null {
  const a = toUtcDay(from);
  const b = toUtcDay(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

function toUtcDay(value: string): number | null {
  const match = DATE.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const time = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(m) - 1 ||
    check.getUTCDate() !== Number(d)
  )
    return null;
  return time;
}

/** Add whole days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const day = toUtcDay(date);
  if (day === null) throw new Error('Not a date');
  return new Date(day + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Decide whether `date` may be recorded as a past day. Returns null when it may.
 * - `today` is the station-local business date now.
 * - `goLiveDate` is the first date the station records here (null: no limit but the window).
 * - `canGoBeyondSupervisorWindow` is true for owner-level people.
 * - `existingDates` are the dates that already have a business day.
 */
export function refusePastDay(input: {
  date: string;
  today: string;
  goLiveDate: string | null;
  canGoBeyondSupervisorWindow: boolean;
  existingDates: ReadonlySet<string>;
}): PastDayRefusal | null {
  const ago = daysBetween(input.date, input.today);
  if (ago === null) return { code: 'BAD_DATE', message: 'Enter a real date.' };
  if (ago < 1) {
    return {
      code: 'NOT_IN_THE_PAST',
      message: 'Only days before today can be recorded this way. Use Daily Operations for today.',
    };
  }
  if (input.goLiveDate) {
    const sinceGoLive = daysBetween(input.goLiveDate, input.date);
    if (sinceGoLive === null || sinceGoLive < 0) {
      return {
        code: 'BEFORE_GO_LIVE',
        message: `This station starts recording on ${input.goLiveDate}. Choose that day or a later one.`,
      };
    }
  }
  if (ago > PAST_DAY_WINDOW_DAYS) {
    return {
      code: 'TOO_FAR_BACK',
      message: `Days more than ${PAST_DAY_WINDOW_DAYS} days ago cannot be recorded.`,
    };
  }
  if (ago > PAST_DAY_SUPERVISOR_DAYS && !input.canGoBeyondSupervisorWindow) {
    return {
      code: 'NEEDS_OWNER',
      message: `Only the owner can record a day more than ${PAST_DAY_SUPERVISOR_DAYS} days ago. Ask the owner to do this one.`,
    };
  }
  if (input.existingDates.has(input.date)) {
    return {
      code: 'ALREADY_EXISTS',
      message: 'This day already has a record. Open it from the day list instead.',
    };
  }
  return null;
}

/** The dates that are missing between go-live (or the window start) and yesterday, oldest first. */
export function missingPastDays(input: {
  today: string;
  goLiveDate: string | null;
  existingDates: ReadonlySet<string>;
  canGoBeyondSupervisorWindow: boolean;
}): string[] {
  const reach = input.canGoBeyondSupervisorWindow ? PAST_DAY_WINDOW_DAYS : PAST_DAY_SUPERVISOR_DAYS;
  const out: string[] = [];
  for (let ago = reach; ago >= 1; ago -= 1) {
    const date = addDays(input.today, -ago);
    if (input.goLiveDate && date < input.goLiveDate) continue;
    if (!input.existingDates.has(date)) out.push(date);
  }
  return out;
}
