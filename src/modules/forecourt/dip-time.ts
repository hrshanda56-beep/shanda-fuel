/**
 * The instant a dip typed on a daily sheet is stamped with. Normally that is now. When the sheet
 * is for an earlier station day (the supervisor is finishing it after midnight), the dip is stamped
 * with the last minute of the sheet's own day in the station's timezone, so it still belongs to
 * that sheet.
 */
const stationDate = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

export function dipInstantForSheet(now: Date, sheetDate: string, timeZone: string): Date {
  if (stationDate(now, timeZone) === sheetDate) return now;
  const [year, month, day] = sheetDate.split('-').map(Number);
  let candidate = new Date(Date.UTC(year!, month! - 1, day!, 23, 59, 0));
  // The station day can start up to 14 hours either side of UTC; walk the hours until inside it.
  for (let i = 0; i < 48 && stationDate(candidate, timeZone) > sheetDate; i += 1) {
    candidate = new Date(candidate.getTime() - 3_600_000);
  }
  for (let i = 0; i < 48 && stationDate(candidate, timeZone) < sheetDate; i += 1) {
    candidate = new Date(candidate.getTime() + 3_600_000);
  }
  // Move on to the last minute of the day: by hours first, then by minutes.
  for (const step of [3_600_000, 60_000]) {
    for (let i = 0; i < 60; i += 1) {
      const next = new Date(candidate.getTime() + step);
      if (stationDate(next, timeZone) !== sheetDate) break;
      candidate = next;
    }
  }
  return candidate;
}
