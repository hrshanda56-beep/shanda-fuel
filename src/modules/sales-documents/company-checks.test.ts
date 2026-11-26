import { describe, expect, it } from 'vitest';
import { checkCompanyName, checkCompanyNumbers, checkCompanyTax } from './company-checks';

describe('company details checks', () => {
  it('needs a name and a sensible email', () => {
    expect(checkCompanyName(' ', '')).toHaveProperty('sd-c-name');
    expect(checkCompanyName('TEI Oils', 'nope')).toHaveProperty('sd-c-email');
    expect(checkCompanyName('TEI Oils', 'a@b.co')).toEqual({});
    expect(checkCompanyName('TEI Oils', '')).toEqual({});
  });

  it('needs a tax name and a percentage up to 100', () => {
    expect(checkCompanyTax('', '0')).toHaveProperty('sd-c-taxlabel');
    expect(checkCompanyTax('VAT', '101')).toHaveProperty('sd-c-rate');
    expect(checkCompanyTax('VAT', '15', 'x'.repeat(61), '')).toHaveProperty('sd-c-tin');
    expect(checkCompanyTax('VAT', '15', '', 'x'.repeat(61))).toHaveProperty('sd-c-regno');
    expect(checkCompanyTax('VAT', '15', '123', '456')).toEqual({});
    expect(checkCompanyTax('VAT', 'abc')).toHaveProperty('sd-c-rate');
    expect(checkCompanyTax('VAT', '15.5')).toEqual({});
    expect(checkCompanyTax('VAT', '')).toEqual({});
  });

  it('needs number prefixes and whole days', () => {
    expect(checkCompanyNumbers('', '', '', '', '')).toHaveProperty('sd-c-qt');
    expect(checkCompanyNumbers('QT', 'INV', 'RC', 'x', '30')).toHaveProperty('sd-c-valid');
    expect(checkCompanyNumbers('QT', 'INV', 'RC', '30', '30')).toEqual({});
  });
});
