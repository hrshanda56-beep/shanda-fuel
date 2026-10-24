import { describe, expect, it } from 'vitest';
import { SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD, paymentNeedsProofFlag } from './payment-proof';

describe('supplier payment proof flag', () => {
  it('uses USD 1000 as the default threshold', () => {
    expect(SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD).toBe('1000');
  });

  it('flags 1000 or more with no proof, exactly', () => {
    expect(paymentNeedsProofFlag('1000', 0)).toBe(true);
    expect(paymentNeedsProofFlag('1000.0000', 0)).toBe(true);
    expect(paymentNeedsProofFlag('5000.50', 0)).toBe(true);
    expect(paymentNeedsProofFlag('999.9999', 0)).toBe(false);
    expect(paymentNeedsProofFlag('0.0001', 0)).toBe(false);
  });

  it('does not flag a payment that has proof', () => {
    expect(paymentNeedsProofFlag('25000', 1)).toBe(false);
    expect(paymentNeedsProofFlag('25000', 3)).toBe(false);
  });

  it('honours a different threshold', () => {
    expect(paymentNeedsProofFlag('500', 0, '500')).toBe(true);
    expect(paymentNeedsProofFlag('499.99', 0, '500')).toBe(false);
  });
});
