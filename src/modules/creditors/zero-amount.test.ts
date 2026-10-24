import { describe, expect, it } from 'vitest';
import { validateSupplierDocument, validateSupplierPayment } from './domain';

const base = { tenantId: 'tenant-1', legalEntityId: 'legal-1', supplierId: 'supplier-1' };

describe('supplier amounts must be greater than zero', () => {
  it.each(['0', '0.00', '0.0000'])('rejects a zero payment of %s', (amount) => {
    expect(() =>
      validateSupplierPayment({
        ...base,
        paymentDate: '2026-09-24',
        currency: 'USD',
        amount,
        reference: 'PAY-0',
      }),
    ).toThrow(/greater than zero/);
  });

  it('rejects a zero invoice', () => {
    expect(() =>
      validateSupplierDocument({
        ...base,
        documentType: 'INVOICE',
        referenceNumber: 'INV-0',
        documentDate: '2026-09-24',
        dueDate: '2026-10-24',
        currency: 'USD',
        amount: '0.00',
      }),
    ).toThrow(/greater than zero/);
  });
});
