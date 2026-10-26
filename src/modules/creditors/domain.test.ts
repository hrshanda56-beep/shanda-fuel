import { describe, expect, it } from 'vitest';
import { money } from '../../platform/domain/primitives';
import {
  assertAllocationWithinCapacity,
  assertSupplierDocumentTransition,
  calculateSupplierPayableBalance,
  outstandingPayable,
  validatePaymentAllocations,
  validateSupplierDocument,
  validateSupplierPayment,
} from './domain';

describe('supplier creditor domain', () => {
  const document = {
    id: 'document-1',
    tenantId: 'tenant-1',
    legalEntityId: 'legal-1',
    supplierId: 'supplier-1',
    documentType: 'INVOICE' as const,
    referenceNumber: 'INV-001',
    documentDate: '2026-09-23',
    currency: 'USD' as const,
    amount: money('100.10'),
    state: 'POSTED' as const,
    deliveryReferences: [],
  };

  it('validates exact supplier documents and payment inputs', () => {
    const validated = validateSupplierDocument({
      tenantId: 'tenant-1',
      legalEntityId: 'legal-1',
      supplierId: 'supplier-1',
      documentType: 'INVOICE',
      referenceNumber: ' INV-001 ',
      documentDate: '2026-09-23',
      dueDate: '2026-10-23',
      currency: 'USD',
      amount: '100.10',
    });
    expect(validated.referenceNumber).toBe('INV-001');
    expect(validated.amount.amount.toString()).toBe('100.1');
    expect(
      validateSupplierPayment({
        tenantId: 'tenant-1',
        legalEntityId: 'legal-1',
        supplierId: 'supplier-1',
        paymentDate: '2026-09-24',
        currency: 'USD',
        amount: '10.10',
        reference: 'PAY-001',
      }).amount.amount.toString(),
    ).toBe('10.1');
  });

  it('rejects negative, invalid-date, and cross-tenant supplier data', () => {
    expect(() =>
      validateSupplierDocument({
        tenantId: 'tenant-1',
        legalEntityId: 'legal-1',
        supplierId: 'supplier-1',
        documentType: 'INVOICE',
        referenceNumber: 'INV-002',
        documentDate: '2026-09-23',
        dueDate: '2026-09-22',
        currency: 'USD',
        amount: '1',
      }),
    ).toThrow('Due date');
    expect(() =>
      validateSupplierPayment({
        tenantId: 'tenant-1',
        legalEntityId: 'legal-1',
        supplierId: 'supplier-1',
        paymentDate: '2026-09-24',
        currency: 'USD',
        amount: '-1',
        reference: 'PAY-002',
      }),
    ).toThrow('greater than zero');
    expect(() =>
      validateSupplierDocument({
        tenantId: 'tenant-1',
        legalEntityId: 'legal-1',
        supplierId: 'supplier-1',
        documentType: 'INVOICE',
        referenceNumber: 'INV-003',
        documentDate: '2026-09-23',
        currency: 'USD',
        amount: '1',
        deliveryReferences: [
          { tenantId: 'tenant-2', stationId: 'station-1', deliveryId: 'delivery-1' },
        ],
      }),
    ).toThrow('document tenant');
  });

  it('keeps posted records on named transitions and derives outstanding payable', () => {
    expect(() => assertSupplierDocumentTransition('POSTED', 'DRAFT')).toThrow('cannot transition');
    expect(outstandingPayable(document, money('40.10')).amount.toString()).toBe('60');
  });

  it('lets only a submitted document be returned, and a returned one goes no further', () => {
    expect(() => assertSupplierDocumentTransition('SUBMITTED', 'RETURNED')).not.toThrow();
    expect(() => assertSupplierDocumentTransition('POSTED', 'RETURNED')).toThrow(
      'cannot transition',
    );
    expect(() => assertSupplierDocumentTransition('RETURNED', 'POSTED')).toThrow(
      'cannot transition',
    );
  });

  it('prevents over-allocation and cross-supplier allocation', () => {
    const payment = {
      id: 'payment-1',
      tenantId: 'tenant-1',
      supplierId: 'supplier-1',
      amount: money('100.10'),
      state: 'POSTED' as const,
    };
    expect(
      validatePaymentAllocations({
        payment,
        documents: [{ ...document, allocatedAmount: money('0'), requestedAmount: money('40.10') }],
      })[0]?.amount.amount.toString(),
    ).toBe('40.1');
    expect(() =>
      validatePaymentAllocations({
        payment,
        documents: [
          {
            ...document,
            supplierId: 'supplier-2',
            allocatedAmount: money('0'),
            requestedAmount: money('40.10'),
          },
        ],
      }),
    ).toThrow('same supplier');
    expect(() => assertAllocationWithinCapacity(money('10'), money('9.99'), money('0.02'))).toThrow(
      'capacity',
    );
  });

  it('derives payable balances from append-only movements with exact arithmetic', () => {
    const balance = calculateSupplierPayableBalance(
      [
        {
          id: '1',
          tenantId: 'tenant-1',
          supplierId: 'supplier-1',
          currency: 'USD',
          movementType: 'INVOICE',
          amount: money('100.10'),
          postedAt: '2026-09-23T00:00:00Z',
          sourceId: 'document-1',
        },
        {
          id: '2',
          tenantId: 'tenant-1',
          supplierId: 'supplier-1',
          currency: 'USD',
          movementType: 'PAYMENT',
          amount: money('0.10'),
          postedAt: '2026-09-24T00:00:00Z',
          sourceId: 'payment-1',
        },
      ],
      'USD',
    );
    expect(balance.amount.toString()).toBe('100');
    expect(() =>
      calculateSupplierPayableBalance(
        [
          {
            id: '1',
            tenantId: 'tenant-1',
            supplierId: 'supplier-1',
            currency: 'USD',
            movementType: 'INVOICE',
            amount: money('1'),
            postedAt: '2026-09-23T00:00:00Z',
            sourceId: 'document-1',
          },
          {
            id: '2',
            tenantId: 'tenant-1',
            supplierId: 'supplier-2',
            currency: 'USD',
            movementType: 'INVOICE',
            amount: money('1'),
            postedAt: '2026-09-23T00:00:00Z',
            sourceId: 'document-2',
          },
        ],
        'USD',
      ),
    ).toThrow('cannot combine');
  });
});
