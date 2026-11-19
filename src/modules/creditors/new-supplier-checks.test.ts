import { describe, expect, it } from 'vitest';
import {
  checkSupplierContact,
  checkSupplierCredit,
  checkSupplierName,
} from './new-supplier-checks';

describe('new supplier checks', () => {
  it('needs a legal name and a code', () => {
    expect(checkSupplierName('', '')).toHaveProperty('supplier-legal-name');
    expect(checkSupplierName('', '')).toHaveProperty('supplier-code');
    expect(checkSupplierName('PUMA', 'Puma Energy')).toEqual({});
  });

  it('accepts an empty email but not a malformed one', () => {
    expect(checkSupplierContact('')).toEqual({});
    expect(checkSupplierContact('a@b.co')).toEqual({});
    expect(checkSupplierContact('nope')).toHaveProperty('supplier-contact-email');
  });

  it('checks the optional credit terms', () => {
    expect(checkSupplierCredit('', '')).toEqual({});
    expect(checkSupplierCredit('30', '5,000.50')).toEqual({});
    expect(checkSupplierCredit('x', '')).toHaveProperty('supplier-credit-days');
    expect(checkSupplierCredit('', 'abc')).toHaveProperty('supplier-create-credit-limit');
  });
});
