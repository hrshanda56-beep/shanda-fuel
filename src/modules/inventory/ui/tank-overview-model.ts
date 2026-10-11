/** Pure helpers for the tank list; product names come only from configuration. */

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
