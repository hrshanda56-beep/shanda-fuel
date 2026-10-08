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
