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
