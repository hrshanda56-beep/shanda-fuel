/** Pure helpers for the tank list; product names come only from configuration. */
import { exact } from '../../reporting/domain';

export type TankProductRow = Readonly<{
  stationId: string;
  productId: string;
  productName: string;
}>;

/** Tanks for the selected station only (the report may cover others). */
export function tanksForStation<T extends TankProductRow>(
  rows: readonly T[],
  stationId: string,
): T[] {
  return rows.filter((row) => row.stationId === stationId);
}

/** Configured products in the order the tanks list them, with tank counts. */
export function tankProducts(
  tanks: readonly TankProductRow[],
): { id: string; name: string; tanks: number }[] {
  const seen = new Map<string, { id: string; name: string; tanks: number }>();
  for (const tank of tanks) {
    const entry = seen.get(tank.productId);
    if (entry) entry.tanks += 1;
    else seen.set(tank.productId, { id: tank.productId, name: tank.productName, tanks: 1 });
  }
  return [...seen.values()];
}

/** A product chosen at another station falls back to "all". */
export function effectiveProduct(products: readonly { id: string }[], chosen: string): string {
  return products.some((entry) => entry.id === chosen) ? chosen : 'all';
}

export type TankLevelInput = Readonly<{
  capacityLitres: string;
  reorderLevelLitres: string | null;
  physicalLitres: string | null;
  expectedLitres: string;
}>;

export type TankLevelState = 'healthy' | 'low' | 'unknown';

export type TankLevel = Readonly<{
  /** The last recorded dip when there is one, otherwise the book quantity. */
  source: 'dip' | 'book';
  litres: string;
  /** Whole percent of capacity, clamped to 0-100; null when capacity is unusable. */
  percent: number | null;
  /** Whole percent where the reorder level sits, for the marker on the drum. */
  reorderPercent: number | null;
  state: TankLevelState;
}>;

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/**
 * Presentation-only fill level for the tank drawing. Percentages are rounded
 * for display; the litres shown beside the drawing stay the exact strings from
 * the report. A missing or non-positive capacity draws an unknown level rather
 * than a full or empty one.
 */
export function tankLevel(tank: TankLevelInput): TankLevel {
  const hasDip = tank.physicalLitres !== null && DECIMAL.test(tank.physicalLitres.trim());
  const source = hasDip ? 'dip' : 'book';
  const litres = (hasDip ? tank.physicalLitres : tank.expectedLitres) ?? '0';
  if (!DECIMAL.test(litres.trim()) || !DECIMAL.test(tank.capacityLitres.trim())) {
    return { source, litres, percent: null, reorderPercent: null, state: 'unknown' };
  }
  const level = exact(litres.trim()).value;
  const capacity = exact(tank.capacityLitres.trim()).value;
  if (capacity.lte(0))
    return { source, litres, percent: null, reorderPercent: null, state: 'unknown' };

  const toPercent = (value: typeof level) =>
    Math.min(100, Math.max(0, value.div(capacity).times(100).toDecimalPlaces(0).toNumber()));
  const reorder =
    tank.reorderLevelLitres !== null && DECIMAL.test(tank.reorderLevelLitres.trim())
      ? exact(tank.reorderLevelLitres.trim()).value
      : null;
  return {
    source,
    litres,
    percent: toPercent(level),
    reorderPercent: reorder === null ? null : toPercent(reorder),
    state: reorder !== null && level.lte(reorder) ? 'low' : 'healthy',
  };
}

export type FuelKind = 'diesel' | 'petrol' | 'blend' | 'other';

/** "T1" becomes "Tank 1"; any other code is shown after the word Tank. */
export function tankLabel(tankCode: string): string {
  const code = tankCode.trim();
  const numbered = /^t(?:ank)?[\s-]*(\d+)$/i.exec(code);
  return numbered ? `Tank ${numbered[1]}` : `Tank ${code}`;
}

/**
 * Picks the liquid colour from the configured product code or name. Purely
 * cosmetic: an unrecognised product gets a neutral colour, never a guess.
 */
export function fuelKind(productCode: string, productName: string): FuelKind {
  const text = `${productCode} ${productName}`.toLowerCase();
  if (/diesel|\bdsl\b|\bd\s?\d{2}\b|gasoil/.test(text)) return 'diesel';
  if (/blend|ethanol|\be\d{2}\b/.test(text)) return 'blend';
  if (/petrol|unleaded|\bulp\b|ulp\d|\blrp\b|gasoline|premium|super/.test(text)) return 'petrol';
  return 'other';
}

/**
 * A horizontal cylinder holds less than its height suggests near the top and
 * bottom, so a 50% volume sits at 50% of the diameter but 25% volume sits well
 * above 25% of the height. Returns the liquid depth (0-1 of the diameter) for
 * a volume fraction (0-1), by bisection on the circular-segment area.
 */
export function cylinderDepth(volumeFraction: number): number {
  const target = Math.min(1, Math.max(0, volumeFraction));
  const area = (depth: number) => {
    const angle = Math.acos(1 - 2 * depth);
    return (angle - Math.sin(angle) * Math.cos(angle)) / Math.PI;
  };
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2;
    if (area(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
