import Decimal from 'decimal.js';

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
  if (!DECIMAL_PATTERN.test(value.trim())) return '—';
  return `${currency} ${new Decimal(value.trim()).toDecimalPlaces(2).toFixed(2)}`.replace(
    /\d+(?=\.\d{2}$)/,
    (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
  );
}

/**
 * A saved money value as it should appear in an input box: "450.0000" becomes "450.00". Only zeros
 * past the cents are dropped, so the value is never changed and saving it again changes nothing.
 */
export function moneyInputValue(value: string): string {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return value;
  const [whole = '', fraction = ''] = trimmed.split('.');
  if (fraction.length <= 2) return trimmed;
  const significant = fraction.replace(/0+$/, '');
  if (significant.length > 2) return trimmed;
  return `${whole}.${significant.padEnd(2, '0')}`;
}

/** Compact USD for dashboards, e.g. "$7,460" or "−$212.40". */
export function formatUsd(value: string): string {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return '—';
  // A whole number stays compact ("$7,460"). Anything with decimals is rounded to cents, however
  // many decimals it is stored with, and a result that rounds to zero carries no minus sign.
  if (!normalized.includes('.')) {
    const negative = normalized.startsWith('-');
    return `${negative ? '−' : ''}$${formatDecimal(negative ? normalized.slice(1) : normalized)}`;
  }
  const cents = new Decimal(normalized).toDecimalPlaces(2);
  return `${cents.isNegative() && !cents.isZero() ? '−' : ''}$${formatDecimal(cents.abs().toFixed(2))}`;
}

export function formatLitres(value: string): string {
  if (!DECIMAL_PATTERN.test(value.trim())) return '—';
  const fixed = new Decimal(value.trim()).toDecimalPlaces(2).toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  const [whole = '', fraction] = trimmed.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''} L`;
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

/** Format an instant with both date and time in the authoritative station timezone. */
export function formatDateTimeInTimeZone(
  value: DateInput,
  timeZone: string | null | undefined,
  locale = 'en-GB',
): string {
  const date = toDate(value);
  if (!date || !timeZone?.trim()) return '—';

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
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
