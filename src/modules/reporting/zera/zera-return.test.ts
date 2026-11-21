import { describe, expect, it } from 'vitest';
import {
  boxForKind,
  buildZeraReturn,
  findMissingMonthDays,
  monthDaysUpTo,
  parseDecimalScaled,
  roundHalfUpWhole,
  type ZeraMovementRow,
} from './zera-return';

function row(
  over: Partial<ZeraMovementRow> & Pick<ZeraMovementRow, 'kind' | 'quantity'>,
): ZeraMovementRow {
  return {
    productId: over.productId ?? `p-${over.kind ?? 'none'}`,
    productName: over.productName ?? String(over.kind),
    blendPercent: null,
    unit: 'LITRES',
    ...over,
  };
}

describe('rounding', () => {
  it('rounds half up once at the end', () => {
    expect(roundHalfUpWhole(parseDecimalScaled('203401.56'))).toBe(203402n);
    expect(roundHalfUpWhole(parseDecimalScaled('0.5'))).toBe(1n);
    expect(roundHalfUpWhole(parseDecimalScaled('0.4999'))).toBe(0n);
    expect(roundHalfUpWhole(parseDecimalScaled('10'))).toBe(10n);
  });

  it("follows ZERA's printed rule: nearest litre, using the form's own example", () => {
    const litres = (text: string) => String(roundHalfUpWhole(parseDecimalScaled(text)));
    expect(litres('203401.56')).toBe('203402'); // the example printed on the form
    expect(litres('203401.44')).toBe('203401');
    expect(litres('203401.5')).toBe('203402'); // exact half goes up
    expect(litres('203401.499999')).toBe('203401');
    expect(litres('0')).toBe('0');
    expect(litres('0.0000')).toBe('0');
  });

  it('rounds the total once, never the individual deliveries', () => {
    // Each line alone rounds down to 0 (0.4 each), but 3 x 0.4 = 1.2 litres, which is 1.
    const lines = Array.from({ length: 3 }, (_, i) =>
      row({ kind: 'PETROL', quantity: '0.4', productId: `p${i}` }),
    );
    const result = buildZeraReturn({ supplied: lines, sold: [], missingDays: [] });
    expect(result.petrol.supplied).toBe('1');
    // Two lines of 0.5 sum to exactly 1.0 (rounding each first would give 2).
    const halves = [
      row({ kind: 'D50', quantity: '0.5', productId: 'a' }),
      row({ kind: 'D50', quantity: '0.5', productId: 'b' }),
    ];
    expect(buildZeraReturn({ supplied: halves, sold: [], missingDays: [] }).diesel50.supplied).toBe(
      '1',
    );
  });

  it('sums exact decimals before rounding (no drift)', () => {
    const rows = Array.from({ length: 10 }, () => row({ kind: 'D50', quantity: '0.1' }));
    const result = buildZeraReturn({ supplied: rows, sold: [], missingDays: [] });
    expect(result.diesel50.supplied).toBe('1');
    const halves = [row({ kind: 'D50', quantity: '0.3' }), row({ kind: 'D50', quantity: '0.2' })];
    expect(buildZeraReturn({ supplied: halves, sold: [], missingDays: [] }).diesel50.supplied).toBe(
      '1',
    );
  });

  it('rejects text that is not a plain decimal', () => {
    expect(() => parseDecimalScaled('1e3')).toThrow();
    expect(() => parseDecimalScaled('')).toThrow();
    // More precision than it can hold exactly is refused, not silently cut.
    expect(() => parseDecimalScaled('0.1234567')).toThrow();
    expect(parseDecimalScaled('0.1234560')).toBe(123456n);
  });
});

describe('mapping to boxes', () => {
  it('sends D50 to Diesel 50ppm and petrol and blends to Petrol', () => {
    expect(boxForKind('D50')).toBe('DIESEL_50');
    expect(boxForKind('PETROL')).toBe('PETROL');
    expect(boxForKind('BLEND')).toBe('PETROL');
    expect(boxForKind('DIESEL')).toBe('NOTES_ONLY');
    expect(boxForKind('GAS')).toBe('NOTES_ONLY');
    expect(boxForKind('OTHER')).toBe('NOTES_ONLY');
    expect(boxForKind(null)).toBe('BLOCKED');
  });

  it('adds petrol and blend into one box and keeps plain diesel out of the diesel 50ppm box', () => {
    const result = buildZeraReturn({
      supplied: [
        row({ kind: 'PETROL', quantity: '1000.4' }),
        row({ kind: 'BLEND', quantity: '500.4', blendPercent: 10 }),
        row({ kind: 'D50', quantity: '200' }),
        row({ kind: 'DIESEL', quantity: '9000', productName: 'Diesel 500' }),
      ],
      sold: [],
      missingDays: [],
    });
    expect(result.petrol.supplied).toBe('1501');
    expect(result.diesel50.supplied).toBe('200');
    expect(result.notes.some((n) => n.text.includes('Diesel 500 supplied 9000'))).toBe(true);
  });

  it('never adds kilograms (gas) to litres', () => {
    const result = buildZeraReturn({
      supplied: [row({ kind: 'GAS', quantity: '300', unit: 'KILOGRAMS', productName: 'LPG' })],
      sold: [],
      missingDays: [],
    });
    expect(result.petrol.supplied).toBe('0');
    expect(result.diesel50.supplied).toBe('0');
    expect(result.notes[0]?.text).toContain('300 kg');
  });

  it('blocks products with no fuel type instead of guessing', () => {
    const result = buildZeraReturn({
      supplied: [row({ kind: null, quantity: '50', productId: 'x', productName: 'Mystery' })],
      sold: [],
      missingDays: [],
    });
    expect(result.blockers).toEqual([{ productId: 'x', productName: 'Mystery' }]);
  });
});

describe('zero and m', () => {
  it('shows 0 when nothing moved', () => {
    const result = buildZeraReturn({ supplied: [], sold: [], missingDays: [] });
    expect(result.diesel50).toEqual({ supplied: '0', sold: '0' });
    expect(result.petrol).toEqual({ supplied: '0', sold: '0' });
  });

  it('marks sold as m when a day has no approved report, and lists the days', () => {
    const result = buildZeraReturn({
      supplied: [row({ kind: 'PETROL', quantity: '100' })],
      sold: [row({ kind: 'PETROL', quantity: '80' })],
      missingDays: ['2026-10-04'],
    });
    expect(result.petrol).toEqual({ supplied: '100', sold: 'm' });
    expect(result.diesel50.sold).toBe('m');
    expect(
      result.notes.some((n) => n.code === 'MISSING_DAYS' && n.text.includes('2026-10-04')),
    ).toBe(true);
  });
});

describe('ethanol percentage', () => {
  it('uses the one blend percentage in use', () => {
    const r = buildZeraReturn({
      supplied: [row({ kind: 'BLEND', quantity: '1', blendPercent: 20 })],
      sold: [],
      missingDays: [],
    });
    expect(r.ethanolPercent).toBe(20);
  });

  it('asks when none is known or several are in use, and honours the choice', () => {
    const none = buildZeraReturn({ supplied: [], sold: [], missingDays: [] });
    expect(none.ethanolPercent).toBeNull();
    const several = buildZeraReturn({
      supplied: [
        row({ kind: 'BLEND', quantity: '1', blendPercent: 10, productId: 'a' }),
        row({ kind: 'BLEND', quantity: '1', blendPercent: 20, productId: 'b' }),
      ],
      sold: [],
      missingDays: [],
    });
    expect(several.ethanolPercent).toBeNull();
    expect(several.ethanolChoices).toEqual([10, 20]);
    expect(
      buildZeraReturn({ supplied: [], sold: [], missingDays: [], chosenEthanolPercent: 15 })
        .ethanolPercent,
    ).toBe(15);
  });
});

describe('missing days in a month', () => {
  it('counts only days already over', () => {
    expect(monthDaysUpTo('2026-10', '2026-10-04')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(monthDaysUpTo('2026-02', '2026-11-21')).toHaveLength(28);
    expect(monthDaysUpTo('2028-02', '2028-03-01')).toHaveLength(29);
  });

  it('skips days before the first business day and days that were approved', () => {
    expect(
      findMissingMonthDays({
        month: '2026-10',
        today: '2026-10-06',
        firstBusinessDate: '2026-10-03',
        approvedDates: ['2026-10-03', '2026-10-05'],
      }),
    ).toEqual(['2026-10-04']);
  });

  it('treats every past day as missing when the station has never reported', () => {
    expect(
      findMissingMonthDays({
        month: '2026-10',
        today: '2026-10-03',
        firstBusinessDate: null,
        approvedDates: [],
      }),
    ).toEqual(['2026-10-01', '2026-10-02']);
  });
});
