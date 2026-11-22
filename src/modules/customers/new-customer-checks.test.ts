import { describe, expect, it } from 'vitest';
import { checkCustomerName, checkCustomerTerms, kindNeedsTerms } from './new-customer-checks';

describe('new customer checks', () => {
  it('needs a name, or the staff member’s name for staff', () => {
    expect(checkCustomerName('', '', '')).toHaveProperty('add-customer-name');
    expect(checkCustomerName('CREDIT', 'Acme', '')).toEqual({});
    expect(checkCustomerName('STAFF', '', '')).toHaveProperty('add-customer-staff');
    expect(checkCustomerName('STAFF', '', 'Tendai')).toEqual({});
  });

  it('needs a limit for credit and staff, and sensible days to pay', () => {
    expect(checkCustomerTerms('', '', '')).toEqual({});
    expect(checkCustomerTerms('PREPAID_VALUE', '', '')).toEqual({});
    expect(checkCustomerTerms('CREDIT', '', '')).toHaveProperty('add-customer-limit');
    expect(checkCustomerTerms('CREDIT', '0', '')).toHaveProperty('add-customer-limit');
    expect(checkCustomerTerms('CREDIT', '1000', '')).toEqual({});
    expect(checkCustomerTerms('CREDIT', '1000', 'x')).toHaveProperty('add-customer-days');
    expect(checkCustomerTerms('CREDIT', '1000', '400')).toHaveProperty('add-customer-days');
    expect(checkCustomerTerms('STAFF', '60.50', '')).toEqual({});
  });

  it('knows which kinds have terms', () => {
    expect(kindNeedsTerms('CREDIT')).toBe(true);
    expect(kindNeedsTerms('PREPAID_LITRES')).toBe(false);
  });
});
