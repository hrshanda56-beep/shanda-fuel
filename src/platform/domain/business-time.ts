import { businessDate, type BusinessDate } from './primitives';

/**
 * Canonical instant -> BusinessDate derivation.
 *
 * A shift (or business day) belongs to the calendar date in the STATION's
 * IANA timezone at the given instant -- never the UTC date, never the
 * browser timezone, never the Node process timezone. `Intl.DateTimeFormat`
 * with an explicit `timeZone` performs this conversion using the ICU tz
 * database regardless of `process.env.TZ`, so this is deterministic across
 * hosts. The `en-CA` locale formats as `YYYY-MM-DD`, matching the
 * `BusinessDate` representation used throughout this repository.
 */
export function deriveBusinessDate(instant: string | Date, ianaTimeZone: string): BusinessDate {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) {
    throw new Error('A valid instant is required to derive a business date');
  }
  if (!ianaTimeZone || typeof ianaTimeZone !== 'string') {
    throw new Error('A station IANA timezone is required to derive a business date');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return businessDate(formatter.format(at));
}
