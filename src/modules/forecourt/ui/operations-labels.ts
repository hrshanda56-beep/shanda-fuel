/** "FORECOURT.OpenBusinessDay" → "Open business day". */
export function eventLabel(eventCode: string) {
  const name = eventCode.includes('.')
    ? eventCode.slice(eventCode.lastIndexOf('.') + 1)
    : eventCode;
  const words = name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Recorded action';
}

/**
 * True when the selected business day is still open but is earlier than the
 * station's current business date (both server values, YYYY-MM-DD). The
 * browser's calendar date is never used, so a late-night or other-timezone
 * viewer sees the same answer as the station.
 */
export function isEarlierOpenDay(
  day: { state: string; date: string } | null | undefined,
  currentBusinessDate: string,
): boolean {
  return Boolean(day && day.state === 'OPEN' && day.date < currentBusinessDate);
}
