import { describe, expect, it } from 'vitest';
import {
  BLEND_PERCENTS,
  compareProducts,
  defaultKindRank,
  parseProductKindInput,
  suggestedFuelName,
} from './product-order';

const names = (rows: Parameters<typeof compareProducts>[0][]) =>
  [...rows].sort(compareProducts).map((r) => r.name);

describe('defaultKindRank', () => {
  it('ranks Diesel/D50 first, Petrol/Blend second, Gas third, everything else last', () => {
    expect(defaultKindRank('DIESEL')).toBe(1);
    expect(defaultKindRank('D50')).toBe(1);
    expect(defaultKindRank('PETROL')).toBe(2);
    expect(defaultKindRank('BLEND')).toBe(2);
    expect(defaultKindRank('GAS')).toBe(3);
    expect(defaultKindRank('OTHER')).toBe(4);
    expect(defaultKindRank(null)).toBe(4);
    expect(defaultKindRank(undefined)).toBe(4);
    expect(defaultKindRank('SOMETHING_NEW')).toBe(4);
  });
});

describe('compareProducts', () => {
  it('orders Diesel, then Petrol/Blend, then Gas, then unknown by name', () => {
    expect(
      names([
        { name: 'Zeta', kind: null },
        { name: 'Gas', kind: 'GAS' },
        { name: 'Blend E10', kind: 'BLEND' },
        { name: 'Alpha', kind: 'OTHER' },
        { name: 'Diesel', kind: 'DIESEL' },
        { name: 'Petrol', kind: 'PETROL' },
      ]),
    ).toEqual(['Diesel', 'Blend E10', 'Petrol', 'Gas', 'Alpha', 'Zeta']);
  });

  it('puts an explicit display order before the default kind rank', () => {
    expect(
      names([
        { name: 'Diesel', kind: 'DIESEL' },
        { name: 'Gas', kind: 'GAS', displayOrder: 1 },
        { name: 'Petrol', kind: 'PETROL', displayOrder: 2 },
      ]),
    ).toEqual(['Gas', 'Petrol', 'Diesel']);
  });

  it('breaks ties by name and leaves legacy rows (null kind) sorted by name', () => {
    expect(
      names([
        { name: 'Unleaded 95', kind: null },
        { name: 'Diesel 50', kind: 'D50' },
        { name: 'Diesel', kind: 'DIESEL' },
        { name: 'Super', kind: null },
      ]),
    ).toEqual(['Diesel', 'Diesel 50', 'Super', 'Unleaded 95']);
  });
});

describe('parseProductKindInput', () => {
  it('accepts the named kinds and trims the name', () => {
    expect(parseProductKindInput({ kind: 'DIESEL', name: ' Diesel ' })).toEqual({
      kind: 'DIESEL',
      blendPercent: null,
      name: 'Diesel',
    });
    expect(parseProductKindInput({ kind: 'D50', name: 'D50' }).kind).toBe('D50');
  });

  it('requires a blend percentage of 5, 10, 15 or 20 for Blend and only for Blend', () => {
    for (const percent of BLEND_PERCENTS) {
      expect(
        parseProductKindInput({ kind: 'BLEND', blendPercent: percent, name: `Blend E${percent}` })
          .blendPercent,
      ).toBe(percent);
    }
    expect(() => parseProductKindInput({ kind: 'BLEND', name: 'Blend' })).toThrow();
    expect(() =>
      parseProductKindInput({ kind: 'BLEND', blendPercent: 7, name: 'Blend' }),
    ).toThrow();
    expect(() =>
      parseProductKindInput({ kind: 'PETROL', blendPercent: 10, name: 'Petrol' }),
    ).toThrow();
  });

  it('requires a typed name for Others and rejects unknown kinds', () => {
    expect(() => parseProductKindInput({ kind: 'OTHER', name: '   ' })).toThrow();
    expect(parseProductKindInput({ kind: 'OTHER', name: 'Paraffin' }).name).toBe('Paraffin');
    expect(() => parseProductKindInput({ kind: 'KEROSENE', name: 'x' })).toThrow();
  });
});

describe('suggestedFuelName', () => {
  it('suggests a name per kind and blend percentage', () => {
    expect(suggestedFuelName('DIESEL')).toBe('Diesel');
    expect(suggestedFuelName('D50')).toBe('D50');
    expect(suggestedFuelName('PETROL')).toBe('Petrol');
    expect(suggestedFuelName('GAS')).toBe('Gas');
    expect(suggestedFuelName('BLEND', 10)).toBe('Blend E10');
    expect(suggestedFuelName('BLEND')).toBe('Blend');
    expect(suggestedFuelName('OTHER')).toBe('');
  });
});
