const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export type DateInput = string | Date;

/** Presentation-only formatting. Authoritative values stay server/domain-owned. */
export function formatDecimal(value: string, suffix = ''): string {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return '—';

  const [integerPart = '', fractionalPart] = normalized.split('.');
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${groupedInteger}${fractionalPart ? `.${fractionalPart}` : ''}${suffix}`;
}

export function formatMoney(value: string, currency = 'USD'): string {
  return `${currency} ${formatDecimal(value)}`;
}

/** Compact USD for dashboards, e.g. "$7,460" or "−$212.40". */
export function formatUsd(value: string): string {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return '—';
  const negative = normalized.startsWith('-');
  return `${negative ? '−' : ''}$${formatDecimal(negative ? normalized.slice(1) : normalized)}`;
}

export function formatLitres(value: string): string {
  return formatDecimal(value, ' L');
}

/**
 * Round a decimal string half away from zero to `places` using integer
 * arithmetic only, so authoritative values never pass through binary floats.
 * Returns undefined for malformed input.
 */
function roundDecimalString(
  value: string,
  places: number,
): { negative: boolean; text: string } | undefined {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return undefined;
  const negative = normalized.startsWith('-');
  const [integerPart = '0', fractionPart = ''] = (
    negative ? normalized.slice(1) : normalized
  ).split('.');
  const padded = fractionPart.padEnd(places + 1, '0');
  const scaled = BigInt(integerPart + padded.slice(0, places)) * 10n;
  const roundingDigit = BigInt(padded.charAt(places));
  const rounded = (scaled + (roundingDigit >= 5n ? 10n : 0n)) / 10n;
  const digits = rounded.toString().padStart(places + 1, '0');
  const whole = places === 0 ? digits : digits.slice(0, -places);
  const fraction = places === 0 ? '' : `.${digits.slice(-places)}`;
  const isZero = /^0*$/.test(whole + fraction.replace('.', ''));
  return {
    negative: negative && !isZero,
    text: `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`,
  };
}

/** Plain money for people: "$1,234.50", "USD 1,234.50" for other currencies, "—" when unknown. */
export function formatMoneyDisplay(value: string | null | undefined, currency = 'USD'): string {
  const rounded = value == null ? undefined : roundDecimalString(value, 2);
  if (!rounded) return '—';
  const sign = rounded.negative ? '−' : '';
  return currency === 'USD' ? `${sign}$${rounded.text}` : `${sign}${currency} ${rounded.text}`;
}

/** Plain litres for people: "1,234 L", with one decimal below 10 L, "—" when unknown. */
export function formatLitresDisplay(value: string | null | undefined): string {
  if (value == null) return '—';
  const small = roundDecimalString(value, 1);
  if (!small) return '—';
  const whole = small.text.replace(/,/g, '');
  const useDecimal = Number(whole.split('.')[0]) < 10;
  const rounded = roundDecimalString(value, useDecimal ? 1 : 0);
  if (!rounded) return '—';
  const text = useDecimal ? rounded.text.replace(/\.0$/, '') : rounded.text;
  return `${rounded.negative ? '−' : ''}${text} L`;
}

export function formatPercentage(value: string): string {
  return formatDecimal(value, '%');
}

export function formatRatio(value: string): string {
  return formatDecimal(value);
}

export function formatDate(value: DateInput, locale = 'en-GB'): string {
  const date = toDate(value);
  if (!date) return '—';

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Business dates are date-only values and must not shift with the browser timezone. */
export function formatBusinessDate(value: string, locale = 'en-GB'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '—';
  }

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Format an instant in the authoritative station timezone, never the viewer's timezone. */
export function formatTimeInTimeZone(
  value: DateInput,
  timeZone: string | null | undefined,
  locale = 'en-GB',
): string {
  const date = toDate(value);
  if (!date || !timeZone?.trim()) return '—';

  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatStatusLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function toDate(value: DateInput): Date | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Sentence-case label for a record status code, e.g. NOT_STARTED -> "Not started". */
export function formatStatusSentence(value: string): string {
  const words = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
