import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { describeUnvaluedOpeningStock } from './unvalued-opening-stock';

describe('describeUnvaluedOpeningStock (B3)', () => {
  it('names one tank and says exactly what to do', () => {
    expect(describeUnvaluedOpeningStock(['T2'])).toBe(
      'Tank T2 has opening stock but no cost per litre. Enter the cost in Settings, under Opening balances, before this station goes live. Without it the stock cannot be valued and profit will be wrong.',
    );
  });

  it('names several tanks together', () => {
    expect(describeUnvaluedOpeningStock(['T1', 'T2'])).toContain('Tanks T1, T2 have opening stock');
  });
});
