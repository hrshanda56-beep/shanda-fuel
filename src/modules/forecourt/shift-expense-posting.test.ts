import { describe, expect, it } from 'vitest';
import { matchExpenseCategory, shiftExpenseReference } from './shift-expense-posting';

const categories = [
  { id: '1', code: 'FUEL_TRANSPORT', name: 'Fuel transport' },
  { id: '2', code: 'MAINTENANCE', name: 'Maintenance' },
  { id: '3', code: 'OTHER', name: 'Other' },
];

describe('matchExpenseCategory', () => {
  it('matches by name or code, ignoring case and spacing', () => {
    expect(matchExpenseCategory('fuel transport', categories)?.id).toBe('1');
    expect(matchExpenseCategory('  MAINTENANCE ', categories)?.id).toBe('2');
    expect(matchExpenseCategory('Fuel_Transport', categories)?.id).toBe('1');
  });

  it('returns nothing for a cost that fits no category, so it falls to Other', () => {
    expect(matchExpenseCategory('Receipt paper', categories)).toBeUndefined();
  });
});

describe('shiftExpenseReference', () => {
  it('is stable for the same report line, so posting twice cannot duplicate it', () => {
    const id = 'abcdef12-0000-4000-8000-000000000000';
    expect(shiftExpenseReference('2026-10-28', id)).toBe('SHIFTREPORT-2026-10-28-abcdef12');
    expect(shiftExpenseReference('2026-10-28', id)).toBe(shiftExpenseReference('2026-10-28', id));
  });
});
