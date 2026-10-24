import { describe, expect, it } from 'vitest';
import {
  assertApproverAllowed,
  assertOrderDates,
  assertPurchaseOrderTransition,
  computeLineReceipt,
  deriveOrderReceiptStatus,
  displayState,
  isAmendableState,
  positiveLitres,
  shortClosedLitres,
  unitPrice,
  validateLines,
} from './domain';

describe('purchase order state machine', () => {
  it('allows the documented transitions only', () => {
    expect(() => assertPurchaseOrderTransition('DRAFT', 'SUBMITTED')).not.toThrow();
    expect(() => assertPurchaseOrderTransition('SUBMITTED', 'APPROVED')).not.toThrow();
    expect(() => assertPurchaseOrderTransition('APPROVED', 'SUBMITTED')).not.toThrow();
    expect(() => assertPurchaseOrderTransition('APPROVED', 'CLOSED')).not.toThrow();
    expect(() => assertPurchaseOrderTransition('DRAFT', 'APPROVED')).toThrow();
    expect(() => assertPurchaseOrderTransition('DRAFT', 'CLOSED')).toThrow();
    expect(() => assertPurchaseOrderTransition('SUBMITTED', 'CLOSED')).toThrow();
    expect(() => assertPurchaseOrderTransition('CANCELLED', 'DRAFT')).toThrow();
    expect(() => assertPurchaseOrderTransition('CLOSED', 'CANCELLED')).toThrow();
  });

  it('cannot move to a derived receipt state by hand', () => {
    expect(() => assertPurchaseOrderTransition('APPROVED', 'RECEIVED' as never)).toThrow();
    expect(() =>
      assertPurchaseOrderTransition('APPROVED', 'PARTIALLY_RECEIVED' as never),
    ).toThrow();
  });

  it('only open states are amendable', () => {
    expect(isAmendableState('APPROVED')).toBe(true);
    expect(isAmendableState('CLOSED')).toBe(false);
    expect(isAmendableState('CANCELLED')).toBe(false);
  });
});

describe('purchase order exact decimals', () => {
  it('accepts three litre decimals and rejects a fourth', () => {
    expect(positiveLitres('10000.125')).toBe('10000.125');
    expect(positiveLitres('0.1')).toBe('0.100');
    expect(() => positiveLitres('1.0001')).toThrow();
    expect(() => positiveLitres('0')).toThrow();
    expect(() => positiveLitres('-1')).toThrow();
    expect(() => positiveLitres('abc')).toThrow();
  });

  it('accepts eight price decimals and rejects a ninth', () => {
    expect(unitPrice('1.23456789')).toBe('1.23456789');
    expect(unitPrice('0')).toBe('0.00000000');
    expect(() => unitPrice('1.234567891')).toThrow();
    expect(() => unitPrice('-0.1')).toThrow();
  });

  it('validates dates and lines', () => {
    expect(() => assertOrderDates('2026-10-01', '2026-10-05')).not.toThrow();
    expect(() => assertOrderDates('2026-10-05', '2026-10-01')).toThrow();
    expect(() => assertOrderDates('2026-02-30', null)).toThrow();
    expect(() => validateLines([])).toThrow();
    const [line] = validateLines([{ productId: 'p', orderedLitres: '5', agreedUnitPrice: '1.5' }]);
    expect(line).toMatchObject({ orderedLitres: '5.000', agreedUnitPrice: '1.50000000' });
    expect(() =>
      validateLines([
        { lineId: 'a', productId: 'p', orderedLitres: '5' },
        { lineId: 'a', productId: 'p', orderedLitres: '6' },
      ]),
    ).toThrow();
  });
});

describe('derived receipt facts', () => {
  const base = { orderedLitres: '10000.000', draftLitres: '0', shortClosedLitres: null };

  it('derives not, partially, and fully received from confirmed litres', () => {
    expect(computeLineReceipt({ ...base, confirmedLitres: '0' }).receiptStatus).toBe(
      'NOT_RECEIVED',
    );
    const partial = computeLineReceipt({ ...base, confirmedLitres: '0.1' });
    expect(partial).toMatchObject({
      receiptStatus: 'PARTIALLY_RECEIVED',
      openLitres: '9999.900',
      overReceiptLitres: '0.000',
    });
    expect(computeLineReceipt({ ...base, confirmedLitres: '10000' }).receiptStatus).toBe(
      'RECEIVED',
    );
  });

  it('exposes over-receipt as an exact fact and ignores draft litres for status', () => {
    const over = computeLineReceipt({ ...base, confirmedLitres: '10000.300' });
    expect(over).toMatchObject({ overReceiptLitres: '0.300', openLitres: '0.000' });
    const draft = computeLineReceipt({ ...base, confirmedLitres: '0', draftLitres: '9000' });
    expect(draft).toMatchObject({ receiptStatus: 'NOT_RECEIVED', pendingLitres: '9000.000' });
  });

  it('keeps 0.1 + 0.2 exact', () => {
    expect(
      computeLineReceipt({
        orderedLitres: '0.300',
        confirmedLitres: '0.300',
        draftLitres: '0',
        shortClosedLitres: null,
      }).receiptStatus,
    ).toBe('RECEIVED');
  });

  it('short-closed lines owe nothing', () => {
    expect(shortClosedLitres('10000.000', '7000.250')).toBe('2999.750');
    expect(shortClosedLitres('10000.000', '12000')).toBe('0.000');
    expect(
      computeLineReceipt({ ...base, confirmedLitres: '7000', shortClosedLitres: '3000.000' })
        .openLitres,
    ).toBe('0.000');
  });

  it('derives the order status and display state', () => {
    expect(deriveOrderReceiptStatus([])).toBe('NOT_RECEIVED');
    expect(
      deriveOrderReceiptStatus([{ receiptStatus: 'RECEIVED' }, { receiptStatus: 'NOT_RECEIVED' }]),
    ).toBe('PARTIALLY_RECEIVED');
    expect(deriveOrderReceiptStatus([{ receiptStatus: 'RECEIVED' }])).toBe('RECEIVED');
    expect(displayState('APPROVED', 'RECEIVED')).toBe('RECEIVED');
    expect(displayState('APPROVED', 'NOT_RECEIVED')).toBe('APPROVED');
    expect(displayState('CLOSED', 'RECEIVED')).toBe('CLOSED');
  });
});

describe('approval separation of duties', () => {
  it('blocks self-approval while another approver exists', () => {
    expect(() =>
      assertApproverAllowed({
        submitterMembershipId: 'a',
        approverMembershipId: 'a',
        alternateApproverExists: true,
      }),
    ).toThrow();
  });

  it('lets a sole approver approve their own order', () => {
    expect(() =>
      assertApproverAllowed({
        submitterMembershipId: 'a',
        approverMembershipId: 'a',
        alternateApproverExists: false,
      }),
    ).not.toThrow();
  });
});
