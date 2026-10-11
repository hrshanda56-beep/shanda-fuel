import { exact } from './domain';

/**
 * Presentation only, for the Reports headline tiles: "USD 1,245.50". The value
 * is rounded half-up to cents for display; the report and its CSV keep the full
 * authoritative precision. Pure; used instead of the shared formatter so other
 * financial screens are unaffected.
 */
export function formatTileMoney(value: string | null | undefined, currency = 'USD'): string {
  const fixed = exact(value).value.toDecimalPlaces(2).toFixed(2);
  const negative = fixed.startsWith('-');
  const [whole = '0', cents = '00'] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${negative && Number(fixed) !== 0 ? '-' : ''}${grouped}.${cents}`;
}

/**
 * Presentation only: whole litres with thousands separators, e.g. "1,284 L".
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
  return `${negative ? '−' : ''}${whole} L`;
}
