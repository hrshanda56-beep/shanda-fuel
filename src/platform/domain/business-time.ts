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

/**
 * The instant a wall-clock time typed as `YYYY-MM-DDTHH:mm` means in the STATION's timezone (what
 * a `datetime-local` field holds), never the browser's. Null when the text is not a real time.
 * Around a clock change the time that does not exist or repeats resolves to a nearby real instant.
 */
export function stationLocalToInstant(local: string, ianaTimeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  // What the wall clock in that zone shows at a given instant, as if it were UTC.
  const shown = (instant: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
  };
  let instant = wall;
  // Two passes settle the offset, including where it changes between the guess and the answer.
  for (let pass = 0; pass < 2; pass += 1) instant = wall - (shown(instant) - instant);
  return new Date(instant);
}
