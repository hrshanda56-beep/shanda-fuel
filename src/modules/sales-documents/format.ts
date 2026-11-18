/** Pure display helpers shared by the screens and the PDF. No floats, no server imports. */

/** Exact decimal string to `places`, half-up, with thousands separators. No floats. */
export function formatAmount(value: string, places = 2, minPlaces = places): string {
  const negative = value.startsWith('-');
  const [intPart = '0', fracRaw = ''] = value.replace(/^-/, '').split('.');
  const frac = fracRaw.padEnd(places + 1, '0');
  let scaled = BigInt(intPart + frac.slice(0, places));
  if (frac.charCodeAt(places) >= 53) scaled += 1n; // next digit >= 5 rounds up
  const digits = scaled.toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let decimals = digits.slice(digits.length - places);
  while (decimals.length > minPlaces && decimals.endsWith('0')) decimals = decimals.slice(0, -1);
  const out = decimals ? `${whole}.${decimals}` : whole;
  return negative && scaled !== 0n ? `-${out}` : out;
}

export const isZero = (value: string): boolean => /^0*\.?0*$/.test(value.replace('-', ''));

export const DOC_LABELS = {
  QUOTATION: { one: 'Quotation', many: 'Quotations' },
  INVOICE: { one: 'Invoice', many: 'Invoices' },
  RECEIPT: { one: 'Receipt', many: 'Receipts' },
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function friendlyDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

/** Adds days to a YYYY-MM-DD date without a time zone. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isStepUpMessage(message: string): boolean {
  return /step-up|strong-authentication/i.test(message);
}

/** Turns a server message into something a station owner can act on. */
export function friendlyError(message: string | null | undefined, fallback: string): string {
  const text = (message ?? '').trim();
  if (!text) return fallback;
  const rules: ReadonlyArray<[RegExp, string]> = [
    [
      /changed since it was loaded|version/i,
      'Someone changed this a moment ago. It has been refreshed, so please look and try again.',
    ],
    [
      /letterhead|company details|profile/i,
      'Set up your company details first, so they can be printed at the top.',
    ],
    [/exceeds|more than.*(owed|balance)/i, 'That is more than what is still owed on this invoice.'],
  ];
  for (const [pattern, reply] of rules) if (pattern.test(text)) return reply;
  return text.length > 200 ? fallback : text;
}
