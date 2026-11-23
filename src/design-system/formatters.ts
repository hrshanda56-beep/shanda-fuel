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

/** What goes before a money figure: "$" for US dollars, otherwise the code and a space. */
export function currencyPrefix(currency: string | null | undefined = 'USD'): string {
  return !currency || currency === 'USD' ? '$' : `${currency} `;
}

/** Money as a person reads it, always with cents: "$9,900.00" or "-$212.40". */
export function formatMoney(
  value: string | null | undefined,
  currency: string | null | undefined = 'USD',
): string {
  if (value === null || value === undefined || !DECIMAL_PATTERN.test(value.trim())) return '—';
  const cents = new Decimal(value.trim()).toDecimalPlaces(2);
  const [whole = '0', fraction = '00'] = cents.abs().toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${currencyPrefix(currency)}${grouped}.${fraction}`;
  return cents.isNegative() && !cents.isZero() ? `(${text})` : text;
}

/** A unit price split for display: "$1.65" and "/L". Unit is "L" or "kg". */
export function formatUnitPrice(value: string, unit: 'L' | 'kg'): { amount: string; unit: string } {
  return { amount: formatMoney(value), unit: `/${unit}` };
}

/**
 * A unit price as a person reads it: "US$1.50/L". Cents are always shown, and extra decimals only
 * when the price really has them (a stored "1.575000" is "US$1.575/L", never "1.575000" and never
 * rounded to "1.58"). An unreadable value is shown as a dash.
 */
export function formatUnitPriceText(value: string, unit: string): string {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return '—';
  const exact = new Decimal(trimmed);
  const places = Math.max(2, exact.decimalPlaces());
  const [whole = '', fraction = ''] = exact.toFixed(places).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}.${fraction}/${unit}`;
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

/** US dollars with cents everywhere, e.g. "$7,460.00" or "−$212.40". */
export function formatUsd(value: string): string {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return '—';
  // Always rounded to cents, however many decimals it is stored with, and a result that rounds to
  // zero carries no minus sign.
  const cents = new Decimal(normalized).toDecimalPlaces(2);
  const text = `$${formatDecimal(cents.abs().toFixed(2))}`;
  return cents.isNegative() && !cents.isZero() ? `(${text})` : text;
}

export function formatLitres(value: string): string {
  if (!DECIMAL_PATTERN.test(value.trim())) return '—';
  const fixed = new Decimal(value.trim()).toDecimalPlaces(2).toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  const [whole = '', fraction] = trimmed.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}L`;
}

export type QuantityUnit = 'LITRES' | 'KILOGRAMS';

/** The short unit written beside a figure: L for litres, kg for kilograms. */
export function quantityUnitShort(unit: QuantityUnit | undefined): string {
  return unit === 'KILOGRAMS' ? 'kg' : 'L';
}

/** A quantity of fuel in its own unit: "1,250L" or "480kg". Litres is the default. */
export function formatQuantity(value: string, unit?: QuantityUnit): string {
  if (unit !== 'KILOGRAMS') return formatLitres(value);
  const formatted = formatLitres(value);
  return formatted === '—' ? formatted : `${formatted.slice(0, -1)}kg`;
}

/** The unit as a word for a table cell: "Litres", "Kilograms" or "Mixed units". */
export function quantityUnitLabel(unit: string | null | undefined): string {
  return unit === 'KILOGRAMS' ? 'Kilograms' : unit === 'MIXED' ? 'Mixed units' : 'Litres';
}

/** A unit read from the database; anything unexpected counts as litres. */
export function asQuantityUnit(value: string | null | undefined): QuantityUnit {
  return value === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES';
}

/** A set of fuels is measured in one unit, or in a mix of both. */
export type CombinedUnit = QuantityUnit | 'MIXED';

/** The one unit a group of fuels shares; "MIXED" when litres and kilograms are both present. */
export function combineQuantityUnits(
  units: readonly (CombinedUnit | null | undefined)[],
): CombinedUnit {
  if (units.includes('MIXED')) return 'MIXED';
  const found = new Set(units.map((unit) => (unit === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES')));
  if (found.size > 1) return 'MIXED';
  return found.has('KILOGRAMS') ? 'KILOGRAMS' : 'LITRES';
}

/** A total across fuels: in the shared unit, or a plain note when the fuels are measured differently. */
export function formatCombinedQuantity(value: string, unit: CombinedUnit | undefined): string {
  return unit === 'MIXED' ? 'Mixed units' : formatQuantity(value, unit);
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
