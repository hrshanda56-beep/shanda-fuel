import { exact } from './domain';
import { currencyPrefix, formatLitres } from '../../design-system/formatters';

/**
 * Presentation only, for the Reports headline tiles: "$1,245.50". The value
 * is rounded half-up to cents for display; the report and its CSV keep the full
 * authoritative precision. Missing or malformed values render "—". Pure; used
 * instead of the shared formatter so other financial screens are unaffected.
 */
export function formatTileMoney(value: string | null | undefined, currency = 'USD'): string {
  // A missing or malformed amount is unknown, never zero, and never throws in render.
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return '—';
  }
  const fixed = exact(value.trim()).value.toDecimalPlaces(2).toFixed(2);
  const negative = fixed.startsWith('-');
  const [whole = '0', cents = '00'] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${currencyPrefix(currency)}${grouped}.${cents}`;
  return negative && Number(fixed) !== 0 ? `(${text})` : text;
}

/**
 * Presentation only: whole litres with thousands separators, e.g. "1,284L".
 * Rounded half-up on the exact decimal; missing or malformed values render
 * "—" so an unknown quantity is never shown as zero.
 */
export function formatTileLitres(value: string | null | undefined): string {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return '—';
  }
  const fixed = exact(value.trim()).value.toDecimalPlaces(0).toFixed(0);
  const negative = fixed.startsWith('-') && fixed !== '-0';
  const whole = (fixed.startsWith('-') ? fixed.slice(1) : fixed).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  return negative ? `(${whole}L)` : `${whole}L`;
}

/** Whole figures in the fuel's own unit: "1,284L" or "480kg". */
export function formatTileQuantity(
  value: string | null | undefined,
  unit?: 'LITRES' | 'KILOGRAMS' | 'MIXED',
): string {
  if (unit === 'MIXED') return 'Mixed units';
  const litres = formatTileLitres(value);
  if (unit !== 'KILOGRAMS') return litres;
  return litres.endsWith('L') ? `${litres.slice(0, -1)}kg` : litres.replace(/L\)$/, 'kg)');
}

export function formatReportLitres(value: string | null): string {
  return value === null ? 'Unavailable' : formatLitres(value);
}
