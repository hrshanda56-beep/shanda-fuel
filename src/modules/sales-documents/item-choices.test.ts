import { describe, expect, it } from 'vitest';
import {
  UNIT_OPTIONS,
  buildFuelChoices,
  isListedUnit,
  matchFuelChoice,
  trimZeros,
} from './item-choices';
import type { SalesDocumentFuelOption } from './queries';

const diesel: SalesDocumentFuelOption = {
  productId: 'p-diesel',
  name: 'Diesel',
  unit: 'LITRES',
  prices: [
    { stationId: 's-a', stationName: 'Main Road', unitPrice: '2.0600' },
    { stationId: 's-b', stationName: 'Hilltop', unitPrice: '2.1000' },
  ],
};
const petrol: SalesDocumentFuelOption = {
  productId: 'p-petrol',
  name: 'Petrol',
  unit: 'LITRES',
  prices: [],
};

describe('buildFuelChoices', () => {
  it('offers a plain option for every fuel, before its station prices', () => {
    const choices = buildFuelChoices([diesel, petrol], null);
    expect(choices.map((c) => c.label)).toEqual([
      'Diesel',
      'Diesel - Main Road (2.06)',
      'Diesel - Hilltop (2.10)',
      'Petrol',
    ]);
    const plain = choices[0]!;
    expect(plain).toMatchObject({ value: 'p-diesel|', price: '', suffix: '' });
  });

  it('keeps only the chosen station price, plus the plain option', () => {
    const choices = buildFuelChoices([diesel], 's-b');
    expect(choices.map((c) => c.label)).toEqual(['Diesel', 'Diesel (2.10)']);
    expect(choices[1]).toMatchObject({ price: '2.1000', suffix: '' });
  });

  it('keeps the exact price text as the starting price', () => {
    const choices = buildFuelChoices(
      [{ ...diesel, prices: [{ stationId: 's-a', stationName: 'A', unitPrice: '2.0655' }] }],
      null,
    );
    expect(choices[1]!.price).toBe('2.0655');
  });
});

describe('matchFuelChoice', () => {
  const choices = buildFuelChoices([diesel, petrol], null);

  it('matches a saved station line to its station option', () => {
    expect(
      matchFuelChoice(choices, {
        productId: 'p-diesel',
        description: 'Diesel - Hilltop',
        unitPrice: '2.1',
      }),
    ).toBe('p-diesel|s-b');
  });

  it('matches a line with a typed price to the plain option', () => {
    expect(
      matchFuelChoice(choices, { productId: 'p-diesel', description: 'Diesel', unitPrice: '1.95' }),
    ).toBe('p-diesel|');
    expect(
      matchFuelChoice(choices, {
        productId: 'p-diesel',
        description: 'Diesel - Hilltop',
        unitPrice: '1.95',
      }),
    ).toBe('p-diesel|');
  });

  it('returns nothing for a typed item or a fuel no longer sold', () => {
    expect(
      matchFuelChoice(choices, { productId: null, description: 'Transport', unitPrice: '5' }),
    ).toBe('');
    expect(
      matchFuelChoice(choices, { productId: 'gone', description: 'Old', unitPrice: '1' }),
    ).toBe('');
  });
});

describe('units', () => {
  it('lists no unit first, then common units', () => {
    expect(UNIT_OPTIONS[0]).toEqual({ value: '', label: 'No unit' });
    expect(isListedUnit('')).toBe(true);
    expect(isListedUnit('trip')).toBe(true);
    expect(isListedUnit('load')).toBe(false);
  });

  it('trims zeros without changing the value', () => {
    expect(trimZeros('2.0600')).toBe('2.06');
    expect(trimZeros('3.0000')).toBe('3');
    expect(trimZeros('100')).toBe('100');
  });
});
