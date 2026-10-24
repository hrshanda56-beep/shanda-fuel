import { describe, expect, it } from 'vitest';
import { buildLandedCost } from './landed-cost';

describe('buildLandedCost', () => {
  it('adds freight and other costs, then divides by the litres that actually arrived', () => {
    const cost = buildLandedCost({
      fuelCost: '10000',
      freight: '500',
      otherCosts: [{ label: 'Offloading', amount: '100' }],
      deliveryLitres: '10600',
      allocationLitres: '10600',
    });
    expect(cost.totalCost).toBe('10600');
    expect(cost.unitCost).toBe('1');
    expect(cost.allocationCost).toBe('10600');
    expect(cost.components.map((c) => c.label)).toEqual(['Fuel', 'Freight', 'Offloading']);
  });

  it('uses the received litres, so a short delivery costs more per litre', () => {
    const noted = buildLandedCost({
      fuelCost: '1000',
      deliveryLitres: '1000',
      allocationLitres: '1000',
    });
    const short = buildLandedCost({
      fuelCost: '1000',
      deliveryLitres: '980',
      allocationLitres: '980',
    });
    expect(noted.unitCost).toBe('1');
    expect(short.unitCost).toBe('1.02040816');
  });

  it('gives each tank its share of the litres', () => {
    const cost = buildLandedCost({
      fuelCost: '9000',
      freight: '300',
      deliveryLitres: '9300',
      allocationLitres: '3100',
    });
    expect(cost.allocationCost).toBe('3100');
    const odd = buildLandedCost({
      fuelCost: '100',
      deliveryLitres: '3',
      allocationLitres: '1',
    });
    expect(odd.allocationCost).toBe('33.3333');
  });

  it('skips costs that are zero and rejects bad input', () => {
    expect(
      buildLandedCost({
        fuelCost: '100',
        freight: '0',
        deliveryLitres: '10',
        allocationLitres: '10',
      }).components,
    ).toHaveLength(1);
    expect(() =>
      buildLandedCost({ fuelCost: '0', deliveryLitres: '10', allocationLitres: '10' }),
    ).toThrow(/greater than zero/);
    expect(() =>
      buildLandedCost({
        fuelCost: '10',
        freight: '-1',
        deliveryLitres: '10',
        allocationLitres: '10',
      }),
    ).toThrow(/negative/);
    expect(() =>
      buildLandedCost({ fuelCost: '10', deliveryLitres: '10', allocationLitres: '11' }),
    ).toThrow(/more than the delivery/);
    expect(() =>
      buildLandedCost({
        fuelCost: '10',
        otherCosts: [{ label: ' ', amount: '5' }],
        deliveryLitres: '10',
        allocationLitres: '10',
      }),
    ).toThrow(/Name each/);
  });
});
