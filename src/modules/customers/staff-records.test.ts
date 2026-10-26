import { describe, expect, it } from 'vitest';

import { staffRecordsWithoutBenefit } from './staff-records';

const record = (id: string, kind: string | undefined, status = 'ACTIVE') => ({
  customerId: id,
  displayName: `Person ${id}`,
  accountReference: `REF-${id}`,
  status,
  contactMetadata: (kind ? { kind } : {}) as Record<string, string>,
});

describe('staffRecordsWithoutBenefit', () => {
  it('lists only active staff records that are not on a benefit yet', () => {
    const options = staffRecordsWithoutBenefit(
      [
        record('a', 'STAFF'),
        record('b', undefined), // an ordinary customer
        record('c', 'STAFF', 'INACTIVE'),
        record('d', 'STAFF'), // already on a benefit
      ],
      new Set(['d']),
    );
    expect(options).toEqual([{ customerId: 'a', name: 'Person a', reference: 'REF-a' }]);
  });

  it('lists nobody when there is no staff record, so the form only adds a new staff member', () => {
    expect(staffRecordsWithoutBenefit([record('x', undefined)], new Set())).toEqual([]);
  });
});
