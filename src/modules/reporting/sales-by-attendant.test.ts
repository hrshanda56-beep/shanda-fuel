import { describe, expect, it } from 'vitest';
import {
  NO_ATTENDANT_LABEL,
  SHARED_SHIFT_LABEL,
  creditSalesByAuthoritativeSegments,
  creditSalesToAttendants,
  type AttendantShiftSale,
} from './sales-by-attendant';

const ann = { id: 'a', name: 'Ann' };
const ben = { id: 'b', name: 'Ben' };
const shift = (
  attendants: AttendantShiftSale['attendants'],
  sales: string,
): AttendantShiftSale => ({
  stationName: 'Main',
  attendants,
  sales,
  accounted: sales,
  litres: '10.5',
});

describe('sales by attendant', () => {
  it('credits a shift to its only attendant and adds exactly', () => {
    const rows = creditSalesToAttendants([
      shift([ann], '0.1'),
      shift([ann], '0.2'),
      shift([ben], '5'),
    ]);
    expect(rows.map((r) => [r.label, r.sales, r.shifts, r.litres])).toEqual([
      ['Ann', '0.3', 2, '21'],
      ['Ben', '5', 1, '10.5'],
    ]);
  });

  it('never splits a shared shift between people', () => {
    const rows = creditSalesToAttendants([shift([ann, ben], '100'), shift([ann], '10')]);
    expect(rows.find((r) => r.label === 'Ann')?.sales).toBe('10');
    expect(rows.find((r) => r.label === 'Ben')).toBeUndefined();
    const shared = rows.find((r) => r.label === SHARED_SHIFT_LABEL);
    expect(shared).toMatchObject({ sales: '100', attendantId: null });
  });

  it('shows shifts with nobody recorded apart from shared shifts, last', () => {
    const rows = creditSalesToAttendants([
      shift([], '7'),
      shift([ann, ben], '1'),
      shift([ann], '2'),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Ann', SHARED_SHIFT_LABEL, NO_ATTENDANT_LABEL]);
  });

  it('keeps stations apart and lets the rule be swapped', () => {
    const rows = creditSalesToAttendants(
      [shift([ann], '1'), { ...shift([ann], '2'), stationName: 'North' }],
      () => ({ attendantId: null, label: 'Everyone' }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.label === 'Everyone')).toBe(true);
  });

  it('splits a shared shift by authoritative litres and keeps exact totals', () => {
    const rows = creditSalesByAuthoritativeSegments([
      {
        ...shift([ann, ben], '100'),
        accounted: '99.9999',
        litres: '10.000',
        authoritativeSegments: [
          { attendantId: 'a', litres: '6.000' },
          { attendantId: 'b', litres: '4.000' },
        ],
      },
    ]);
    expect(
      rows.map((row) => [row.label, row.litres, row.sales, row.accounted, row.shifts]),
    ).toEqual([
      ['Ann', '6', '60', '59.9999', 1],
      ['Ben', '4', '40', '40', 1],
    ]);
  });

  it('keeps a truthful shared row when authoritative attribution is incomplete', () => {
    const rows = creditSalesByAuthoritativeSegments([
      {
        ...shift([ann, ben], '100'),
        authoritativeSegments: [{ attendantId: null, litres: '10.5' }],
      },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        label: SHARED_SHIFT_LABEL,
        attendantId: null,
        litres: '10.5',
        sales: '100',
        shifts: 1,
      }),
    ]);
  });
});
