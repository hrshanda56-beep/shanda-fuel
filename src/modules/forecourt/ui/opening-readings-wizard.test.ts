import { describe, expect, it } from 'vitest';

import {
  checkReading,
  pumpName,
  readingPosition,
  sortPumps,
  startingReadings,
  unpricedPumps,
  type OpeningPump,
} from './opening-readings-wizard';

const pump = (over: Partial<OpeningPump> = {}): OpeningPump => ({
  nozzleId: 'n1',
  pumpNumber: '1',
  nozzleNumber: '1',
  productName: 'Diesel 50',
  sellingPriceId: 'price-1',
  previousReading: null,
  ...over,
});

describe('opening readings: order and names', () => {
  it('puts pumps in forecourt order, numbers before lengths', () => {
    const sorted = sortPumps([
      pump({ nozzleId: 'c', pumpNumber: '10', nozzleNumber: '1' }),
      pump({ nozzleId: 'b', pumpNumber: '2', nozzleNumber: '2' }),
      pump({ nozzleId: 'a', pumpNumber: '2', nozzleNumber: '1' }),
    ]);
    expect(sorted.map((item) => item.nozzleId)).toEqual(['a', 'b', 'c']);
  });

  it('does not change the list it is given', () => {
    const input = [pump({ nozzleId: 'b', pumpNumber: '2' }), pump({ nozzleId: 'a' })];
    sortPumps(input);
    expect(input.map((item) => item.nozzleId)).toEqual(['b', 'a']);
  });

  it('names a pump and its nozzle', () => {
    expect(pumpName(pump({ pumpNumber: '3', nozzleNumber: '2' }))).toBe('Pump 3, nozzle 2');
  });

  it('starts each pump on its last closing reading, or empty', () => {
    expect(
      startingReadings([
        pump({ nozzleId: 'a', previousReading: '1200.500' }),
        pump({ nozzleId: 'b', previousReading: null }),
      ]),
    ).toEqual({ a: '1200.500', b: '' });
  });
});

describe('opening readings: checking one reading', () => {
  it('accepts whole numbers and up to three decimals, and trims spaces', () => {
    for (const value of ['0', '12345', ' 12345.5 ', '12345.125']) {
      const checked = checkReading(value, pump());
      expect(checked).toEqual({ ok: true, value: value.trim() });
    }
  });

  it('asks for a reading when it is empty', () => {
    const checked = checkReading('  ', pump({ pumpNumber: '2', nozzleNumber: '1' }));
    expect(checked).toEqual({
      ok: false,
      message: 'Enter what the meter of pump 2, nozzle 1 shows.',
    });
  });

  it('refuses negatives, letters, commas and more than three decimals', () => {
    for (const value of ['-5', '12a', '1,5', '12.3456', '.5', '1e3', '12.']) {
      expect(checkReading(value, pump()).ok, value).toBe(false);
    }
  });
});

describe('opening readings: pumps without a price and the step count', () => {
  it('lists the pumps whose fuel has no selling price', () => {
    const missing = pump({ nozzleId: 'x', sellingPriceId: null });
    expect(unpricedPumps([pump(), missing])).toEqual([missing]);
    expect(unpricedPumps([pump()])).toEqual([]);
  });

  it('counts one screen per pump plus the check screen', () => {
    expect(readingPosition(3, 0, false)).toEqual({ position: 1, total: 4 });
    expect(readingPosition(3, 2, false)).toEqual({ position: 3, total: 4 });
    expect(readingPosition(3, 0, true)).toEqual({ position: 4, total: 4 });
  });
});
