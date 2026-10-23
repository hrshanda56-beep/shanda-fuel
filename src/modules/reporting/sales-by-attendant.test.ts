import { describe, expect, it } from 'vitest';
import {
  NO_ATTENDANT_LABEL,
  SHARED_SHIFT_LABEL,
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

describe('sales by attendant (sole-attendant rule, awaiting owner confirmation)', () => {
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
});
