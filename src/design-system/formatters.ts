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

/**
 * One money format everywhere: the currency code, a thousands separator and exactly two decimals
 * (`USD 50.00`). A negative amount keeps its sign in front of the code with a true minus
 * (`−USD 10,597.00`). Rounding is half-up and only for display.
 */
export function formatMoney(value: string, currency = 'USD'): string {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return '—';
  const amount = new Decimal(normalized).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const negative = amount.isNegative() && !amount.isZero();
  return `${negative ? '−' : ''}${currency} ${formatDecimal(amount.abs().toFixed(2))}`;
}

export type DifferenceDisplay = Readonly<{
  /** The sentence under a difference value: "Over by USD 50.00", "Short by USD 10,597.00" or "Balanced". */
  words: string;
  tone: 'over' | 'short' | 'balanced';
}>;

/** Direction in words for a difference (accounted for or counted, minus expected). */
export function describeDifference(value: string | null | undefined, currency = 'USD'): DifferenceDisplay | null {
  if (value === null || value === undefined || !DECIMAL_PATTERN.test(value.trim())) return null;
  const amount = new Decimal(value.trim()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (amount.isZero()) return { words: 'Balanced', tone: 'balanced' };
  return amount.isPositive()
    ? { words: `Over by ${formatMoney(amount.toFixed(), currency)}`, tone: 'over' }
    : { words: `Short by ${formatMoney(amount.abs().toFixed(), currency)}`, tone: 'short' };
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
