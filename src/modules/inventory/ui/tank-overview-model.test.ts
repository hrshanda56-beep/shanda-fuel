import { describe, expect, it } from 'vitest';

import { formatTileLitres } from '../../reporting/format';
import { effectiveProduct, tankProducts, tanksForStation } from './tank-overview-model';

const tank = (stationId: string, productId: string, productName: string) => ({
  stationId,
  productId,
  productName,
});

describe('tank list', () => {
  it('shows only the selected station and configured product names as given', () => {
    const rows = [
      tank('s1', 'p1', 'ULP 95'),
      tank('s2', 'p2', 'Diesel 50ppm'),
      tank('s1', 'p1', 'ULP 95'),
      tank('s1', 'p3', 'Blend E10'),
    ];
    const station = tanksForStation(rows, 's1');
    expect(station).toHaveLength(3);
    expect(tankProducts(station)).toEqual([
      { id: 'p1', name: 'ULP 95', tanks: 2 },
      { id: 'p3', name: 'Blend E10', tanks: 1 },
    ]);
  });

  it('falls back to all products when the chosen one is not at this station', () => {
    const products = [{ id: 'p1' }];
    expect(effectiveProduct(products, 'p1')).toBe('p1');
    expect(effectiveProduct(products, 'p9')).toBe('all');
    expect(effectiveProduct([], 'all')).toBe('all');
  });

  it('shows a missing dip as "—" and an actual zero as 0 L', () => {
    expect(formatTileLitres(null)).toBe('—');
    expect(formatTileLitres('0.0000')).toBe('0 L');
    expect(formatTileLitres('-3.5')).toBe('−4 L');
  });
});
