/**
 * Convert a datetime-local wall-clock value entered for a station into an ISO
 * instant using that station's IANA timezone. A datetime-local value has no
 * timezone of its own; calling `new Date(value)` would silently use the
 * operator's browser timezone instead.
 */
export function stationLocalDateTimeToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('A complete station-local date and time is required');
  const [, year, month, day, hour, minute, second = '00'] = match;
  const wallClock = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (!Number.isFinite(wallClock))
    throw new Error('A valid station-local date and time is required');
  const wallDate = new Date(wallClock);
  if (
    wallDate.getUTCFullYear() !== Number(year) ||
    wallDate.getUTCMonth() !== Number(month) - 1 ||
    wallDate.getUTCDate() !== Number(day) ||
    wallDate.getUTCHours() !== Number(hour) ||
    wallDate.getUTCMinutes() !== Number(minute) ||
    wallDate.getUTCSeconds() !== Number(second)
  )
    throw new Error('A valid station-local date and time is required');

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  // Resolve the offset from a nearby instant, then repeat once so DST
  // transitions converge even when the first guess crosses an offset change.
  let instant = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value: part }) => [type, part]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant = wallClock - (representedAsUtc - instant);
  }
  return new Date(instant).toISOString();
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
