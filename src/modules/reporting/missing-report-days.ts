export type MissingReportStation = Readonly<{
  stationId: string;
  /** First business date the station is expected to report (YYYY-MM-DD). */
  goLiveDate: string;
  /** Shift templates the station is expected to submit every day. */
  expectedShifts: readonly string[];
}>;

export type SubmittedShift = Readonly<{
  stationId: string;
  businessDate: string;
  shiftTemplate: string;
}>;

export type MissingReportDay = Readonly<{
  stationId: string;
  businessDate: string;
  missingShifts: readonly string[];
}>;

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Business days that should have a report and do not. For every station, each day from its
 * go-live date up to the latest day that is already late is checked; the day is missing when any
 * expected shift has no submitted reconciliation. Today is never missing, and `lateAfterDays`
 * gives managers that many extra days before a day counts as late. The check does not depend on
 * the period shown on a screen, so a gap outside the selected period is still found.
 */
export function findMissingReportDays(input: {
  stations: readonly MissingReportStation[];
  submitted: readonly SubmittedShift[];
  /** The station-local date today (YYYY-MM-DD). */
  today: string;
  lateAfterDays: number;
}): MissingReportDay[] {
  const done = new Set(
    input.submitted.map((row) => `${row.stationId}|${row.businessDate}|${row.shiftTemplate}`),
  );
  const anySubmitted = new Set(
    input.submitted.map((row) => `${row.stationId}|${row.businessDate}`),
  );
  const lastDue = addDays(input.today, -1 - Math.max(0, input.lateAfterDays));
  const missing: MissingReportDay[] = [];
  for (const station of input.stations) {
    for (let date = station.goLiveDate; date <= lastDue; date = addDays(date, 1)) {
      const missingShifts =
        station.expectedShifts.length > 0
          ? station.expectedShifts.filter(
              (shift) => !done.has(`${station.stationId}|${date}|${shift}`),
            )
          : // No templates: one report of any kind is expected each day.
            anySubmitted.has(`${station.stationId}|${date}`)
            ? []
            : ['ANY'];
      if (missingShifts.length > 0) {
        missing.push({ stationId: station.stationId, businessDate: date, missingShifts });
      }
    }
  }
  return missing;
}
