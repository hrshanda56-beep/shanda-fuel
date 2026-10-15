/**
 * How a shift is named everywhere: "Morning · 06:00–14:00". The name comes from the start time in the
 * station's own time zone (05:00–11:59 morning, 12:00–17:59 afternoon, otherwise night), so it never
 * changes with the viewer's device. A shift's status is shown beside its name, never in its place.
 */
export type ShiftName = 'Morning' | 'Afternoon' | 'Night';

function localHour(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(iso));
  return Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
}

export function shiftNameFor(startIso: string, timeZone: string): ShiftName {
  const hour = localHour(startIso, timeZone);
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 18) return 'Afternoon';
  return 'Night';
}

export function shiftTimeRange(startIso: string, endIso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  return `${formatter.format(new Date(startIso))}–${formatter.format(new Date(endIso))}`;
}

export function shiftLabel(startIso: string, endIso: string, timeZone: string): string {
  return `${shiftNameFor(startIso, timeZone)} · ${shiftTimeRange(startIso, endIso, timeZone)}`;
}
