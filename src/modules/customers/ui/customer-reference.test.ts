import { describe, expect, it } from 'vitest';
import { isDuplicateCustomerName } from './customer-reference';

describe('isDuplicateCustomerName', () => {
  const existing = ['Zuva Haulage', 'Mapfumo  Transport'];

  it('finds the same name whatever the case or spacing', () => {
    expect(isDuplicateCustomerName('zuva haulage', existing)).toBe(true);
    expect(isDuplicateCustomerName('  Mapfumo Transport ', existing)).toBe(true);
  });

  it('is quiet for a new or empty name', () => {
    expect(isDuplicateCustomerName('Zuva Haulage Ltd', existing)).toBe(false);
    expect(isDuplicateCustomerName('   ', existing)).toBe(false);
  });
});
