import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { DEFAULT_EXPENSE_CATEGORIES } from './default-categories';
import { isStaffFuelCategory } from './domain';

describe('standard expense categories (B8)', () => {
  it('has the categories a station needs, so maintenance is never filed under utilities', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES.map((category) => category.name)).toEqual([
      'Maintenance',
      'Cleaning',
      'Utilities',
      'Security',
      'Fuel transport',
      'Bank charges',
      'Other',
    ]);
  });

  it('gives each a stable code and an operating classification, without repeats', () => {
    const codes = DEFAULT_EXPENSE_CATEGORIES.map((category) => category.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const category of DEFAULT_EXPENSE_CATEGORIES) {
      expect(category.code).toMatch(/^[A-Z][A-Z_]*$/);
      expect(category.classification).toBe('OPERATING');
    }
  });

  it('never includes the reserved staff fuel category, which has its own flow', () => {
    expect(DEFAULT_EXPENSE_CATEGORIES.some((category) => isStaffFuelCategory(category))).toBe(
      false,
    );
  });
});
