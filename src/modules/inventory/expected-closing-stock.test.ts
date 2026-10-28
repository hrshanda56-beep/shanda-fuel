import { describe, expect, it } from 'vitest';
import { expectedClosingStock } from './expected-closing-stock';

describe('expectedClosingStock', () => {
  it('includes current unapproved sales and approved adjustments', () => {
    expect(
      expectedClosingStock({
        openingLitres: '5000',
        deliveriesLitres: '1000',
        litresSold: '450',
        approvedAdjustmentsLitres: '-10',
      }),
    ).toBe('5540.000');
  });

  it.each(['28', '30', '31'])(
    'keeps exact litre arithmetic independent of month length (%s)',
    () => {
      expect(
        expectedClosingStock({ openingLitres: '116389', deliveriesLitres: '0', litresSold: '450' }),
      ).toBe('115939.000');
    },
  );
});
