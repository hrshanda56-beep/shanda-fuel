import { describe, expect, it } from 'vitest';

import { formatTileLitres } from '../../reporting/format';
import {
  cylinderDepth,
  effectiveProduct,
  fuelKind,
  tankLabel,
  tankLevel,
  tankProducts,
  tanksForStation,
} from './tank-overview-model';

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

describe('tankLevel', () => {
  const base = {
    capacityLitres: '50000.000',
    reorderLevelLitres: '8000.000',
    physicalLitres: '41050.000',
    expectedLitres: '41200.000',
  };

  it('prefers the last dip over the book quantity', () => {
    expect(tankLevel(base)).toMatchObject({
      source: 'dip',
      litres: '41050.000',
      percent: 82,
      reorderPercent: 16,
      state: 'healthy',
    });
  });

  it('falls back to book when no dip is recorded', () => {
    expect(tankLevel({ ...base, physicalLitres: null })).toMatchObject({
      source: 'book',
      litres: '41200.000',
      percent: 82,
    });
  });

  it('flags a tank at or below its reorder level as low', () => {
    expect(tankLevel({ ...base, physicalLitres: '8000.000' }).state).toBe('low');
    expect(tankLevel({ ...base, physicalLitres: '7999.999' }).state).toBe('low');
    expect(tankLevel({ ...base, physicalLitres: '8000.001' }).state).toBe('healthy');
  });

  it('stays healthy when no reorder level is configured', () => {
    expect(
      tankLevel({ ...base, reorderLevelLitres: null, physicalLitres: '10.000' }),
    ).toMatchObject({ state: 'healthy', reorderPercent: null });
  });

  it('clamps the drawing to the tank and never reports a negative fill', () => {
    expect(tankLevel({ ...base, physicalLitres: null, expectedLitres: '-120.000' }).percent).toBe(
      0,
    );
    expect(tankLevel({ ...base, physicalLitres: '60000.000' }).percent).toBe(100);
  });

  it('draws an unknown level when capacity is unusable', () => {
    expect(tankLevel({ ...base, capacityLitres: '0' })).toMatchObject({
      percent: null,
      state: 'unknown',
    });
    expect(tankLevel({ ...base, capacityLitres: 'n/a' }).state).toBe('unknown');
  });
});

describe('fuelKind', () => {
  it('recognises common product codes and names', () => {
    expect(fuelKind('DIESEL', 'Diesel 50')).toBe('diesel');
    expect(fuelKind('D50', 'Diesel 50ppm')).toBe('diesel');
    expect(fuelKind('ULP95', 'Unleaded 95')).toBe('petrol');
    expect(fuelKind('BLEND', 'Blend')).toBe('blend');
    expect(fuelKind('PARAF', 'Paraffin')).toBe('other');
  });
});

describe('cylinderDepth', () => {
  it('maps volume to liquid depth in a horizontal cylinder', () => {
    expect(cylinderDepth(0)).toBeCloseTo(0, 4);
    expect(cylinderDepth(0.5)).toBeCloseTo(0.5, 4);
    expect(cylinderDepth(1)).toBeCloseTo(1, 4);
    expect(cylinderDepth(0.25)).toBeCloseTo(0.3, 1);
  });
});

describe('tankLabel', () => {
  it('spells out numbered tank codes', () => {
    expect(tankLabel('T1')).toBe('Tank 1');
    expect(tankLabel('t12')).toBe('Tank 12');
    expect(tankLabel('Tank 3')).toBe('Tank 3');
  });

  it('keeps other codes after the word Tank', () => {
    expect(tankLabel('NORTH')).toBe('Tank NORTH');
  });
});
