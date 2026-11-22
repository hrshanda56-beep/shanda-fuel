/**
 * "Meter working since": the station date from which a nozzle's meter counts as working. A shift
 * can only be closed against a meter that was working when the shift opened, so a nozzle added
 * after a shift started needs this date set to the day the meter was really fitted.
 *
 * The owner picks a calendar date. The command turns it into the start of that day in the
 * station's own timezone (never the browser's), so these checks work on plain dates. Pure.
 */

/** The furthest back a meter's start date may be set, so a typo cannot reach into another era. */
export const MAX_BACKDATE_DAYS = 366;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayNumber(date: string): number | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.round(utc.getTime() / 86_400_000);
}

/** Returns a plain-language reason the date cannot be used, or null when it can. */
export function checkMeterWorkingSinceDate(date: string, stationToday: string): string | null {
  const chosen = dayNumber(date);
  const today = dayNumber(stationToday);
  if (chosen === null || today === null)
    return 'Choose a real date for when the meter started working.';
  if (chosen > today) return 'The date a meter started working cannot be in the future.';
  if (today - chosen > MAX_BACKDATE_DAYS) {
    return 'That date is more than a year ago. Check it and choose the day the meter was fitted.';
  }
  return null;
}

/** "29 Oct 2026" for a station date, or "Not set". */
export function describeMeterWorkingSince(date: string | null): string {
  if (!date || dayNumber(date) === null) return 'Not set';
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
