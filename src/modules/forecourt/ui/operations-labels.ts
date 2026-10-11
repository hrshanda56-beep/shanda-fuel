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
