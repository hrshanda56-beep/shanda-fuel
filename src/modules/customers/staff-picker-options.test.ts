import { describe, expect, it } from 'vitest';
import { filterStaffOptions, type StaffPickerOption } from './staff-picker-options';

const people: StaffPickerOption[] = [
  { membershipId: 'a', name: 'Tendai Moyo', email: 'tendai@example.com' },
  { membershipId: 'b', name: 'Rudo Chikwanha', email: 'rudo@example.com' },
  { membershipId: 'c', name: 'Moyo Ncube', email: 'ncube@example.com' },
];

describe('filterStaffOptions', () => {
  it('lists everyone for an empty query', () => {
    expect(filterStaffOptions(people, '  ')).toHaveLength(3);
  });

  it('matches name words in any order, ignoring case', () => {
    expect(filterStaffOptions(people, 'moyo').map((p) => p.membershipId)).toEqual(['a', 'c']);
    expect(filterStaffOptions(people, 'MOYO tendai').map((p) => p.membershipId)).toEqual(['a']);
  });

  it('matches email and returns nothing when there is no match', () => {
    expect(filterStaffOptions(people, 'rudo@').map((p) => p.membershipId)).toEqual(['b']);
    expect(filterStaffOptions(people, 'zzz')).toEqual([]);
  });
});
