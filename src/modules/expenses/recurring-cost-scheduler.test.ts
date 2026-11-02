import { describe, expect, it } from 'vitest';
import { recognitionDatesThrough } from './recurring-cost-scheduler';

describe('automatic recurring-cost date coverage', () => {
  it('returns every calendar date inclusively and handles month boundaries', () => {
    expect(recognitionDatesThrough('2024-02-28', '2024-03-02')).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
      '2024-03-02',
    ]);
  });

  it('does not create work for a date before the period starts', () => {
    expect(recognitionDatesThrough('2026-10-01', '2026-09-30')).toEqual([]);
  });
});
