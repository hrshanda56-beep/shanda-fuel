import { describe, expect, it } from 'vitest';
import { assertCreditFuelDetails, normaliseVoucher } from './entry-rules';

describe('assertCreditFuelDetails', () => {
  it('asks for the vehicle and the voucher on credit fuel', () => {
    expect(() => assertCreditFuelDetails(undefined)).toThrow(/vehicle registration and voucher/);
    expect(() => assertCreditFuelDetails({ vehicleRegistration: 'ABC 1234' })).toThrow(
      /voucher number/,
    );
    expect(() => assertCreditFuelDetails({ voucherNumber: 'V-1' })).toThrow(/vehicle registration/);
  });
  it('accepts both, with the driver left out', () => {
    expect(() =>
      assertCreditFuelDetails({ vehicleRegistration: 'ABC 1234', voucherNumber: 'V-1' }),
    ).not.toThrow();
  });
});

describe('normaliseVoucher', () => {
  it('ignores case and extra spaces', () => {
    expect(normaliseVoucher(' v-12  a ')).toBe('V-12 A');
  });
});
