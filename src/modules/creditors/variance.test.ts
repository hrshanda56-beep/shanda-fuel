import { describe, expect, it } from 'vitest';
import { BUILT_IN_PURCHASING_POLICY } from './purchasing-policy';
import {
  allowedDifference,
  classifyCoverage,
  evaluateDeliveryVariance,
  assessOverReceipt,
  isWithinTolerance,
  netBilledAmount,
  netBilledLitres,
  type VarianceInput,
} from './variance';

const policy = BUILT_IN_PURCHASING_POLICY;

function input(overrides: Partial<VarianceInput> = {}): VarianceInput {
  return {
    noteQuantityLitres: '1000.000',
    acceptedQuantityLitres: '1000.000',
    invoicedQuantityLitres: '1000.000',
    invoicedUnitPrice: '1.20000000',
    invoicedNetAmount: '1200.0000',
    referenceUnitCost: '1.20000000',
    deliveryLabel: 'DN-1',
    policy,
    ...overrides,
  };
}

describe('coverage classification', () => {
  it('classifies exactly, never with floating point', () => {
    expect(classifyCoverage('1000.300', '0', false)).toBe('UNBILLED');
    expect(classifyCoverage('1000.300', '1000.200', true)).toBe('PARTIALLY_BILLED');
    expect(classifyCoverage('1000.300', '1000.300', true)).toBe('BILLED');
    expect(classifyCoverage('1000.200', '1000.300', true)).toBe('OVER_BILLED');
    expect(classifyCoverage('0.3', '0.1', true)).toBe('PARTIALLY_BILLED');
  });
});

describe('tolerance arithmetic', () => {
  it('treats an unconfigured tolerance as zero', () => {
    expect(allowedDifference('1000', { absolute: null, percent: null }).toString()).toBe('0');
    expect(isWithinTolerance('0', '1000', { absolute: null, percent: null })).toBe(true);
    expect(isWithinTolerance('0.001', '1000', { absolute: null, percent: null })).toBe(false);
  });

  it('puts the boundary inside tolerance (0.3 - 0.2 style exactness)', () => {
    const tolerance = { absolute: '0.1', percent: null };
    // 0.3 - 0.2 is 0.09999999999999998 in binary floating point; here it is exactly 0.1.
    expect(isWithinTolerance('0.1', '1000', tolerance)).toBe(true);
    expect(isWithinTolerance('0.101', '1000', tolerance)).toBe(false);
    expect(isWithinTolerance('-0.1', '1000', tolerance)).toBe(true);
  });

  it('takes the greater of the absolute and percent allowance', () => {
    const tolerance = { absolute: '2', percent: '0.5' };
    expect(allowedDifference('1000', tolerance).toString()).toBe('5');
    expect(allowedDifference('100', tolerance).toString()).toBe('2');
    expect(isWithinTolerance('5', '1000', tolerance)).toBe(true);
    expect(isWithinTolerance('5.001', '1000', tolerance)).toBe(false);
  });
});

describe('delivery variance', () => {
  it('reports nothing when everything agrees', () => {
    const result = evaluateDeliveryVariance(input());
    expect(result.findings).toEqual([]);
    expect(result.exceeded).toBe(false);
    expect(result.invoiceExceeded).toBe(false);
  });

  it('flags any over-billing under zero tolerance and says so in plain language', () => {
    const result = evaluateDeliveryVariance(
      input({
        invoicedQuantityLitres: '1000.300',
        acceptedQuantityLitres: '1000.200',
        noteQuantityLitres: '1000.200',
        invoicedNetAmount: null,
      }),
    );
    const finding = result.findings.find((item) => item.code === 'QUANTITY_OVER_BILLED');
    expect(finding?.difference).toBe('0.100');
    expect(finding?.message).toContain(
      'bills 1000.300 litres but only 1000.200 litres were received',
    );
    expect(result.invoiceExceeded).toBe(true);
  });

  it('accepts a difference exactly at the configured quantity tolerance and rejects one more', () => {
    const tolerant = { ...policy, quantityToleranceLitres: '0.100' };
    const at = evaluateDeliveryVariance(
      input({
        policy: tolerant,
        invoicedQuantityLitres: '1000.300',
        acceptedQuantityLitres: '1000.200',
        noteQuantityLitres: '1000.200',
        invoicedNetAmount: null,
      }),
    );
    expect(at.findings.filter((item) => item.code === 'QUANTITY_OVER_BILLED')).toHaveLength(0);
    const over = evaluateDeliveryVariance(
      input({
        policy: tolerant,
        invoicedQuantityLitres: '1000.301',
        acceptedQuantityLitres: '1000.200',
        noteQuantityLitres: '1000.200',
        invoicedNetAmount: null,
      }),
    );
    expect(over.findings.some((item) => item.code === 'QUANTITY_OVER_BILLED')).toBe(true);
  });

  it('shows under-billing as information, never as an exception', () => {
    const result = evaluateDeliveryVariance(
      input({ invoicedQuantityLitres: '600.000', invoicedNetAmount: null }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: 'QUANTITY_UNDER_BILLED', severity: 'INFO' });
    expect(result.exceeded).toBe(false);
  });

  it('judges price against the recorded receipt cost with a percent tolerance', () => {
    const tolerant = { ...policy, priceTolerancePercent: '2.0000' };
    const within = evaluateDeliveryVariance(
      input({ policy: tolerant, invoicedUnitPrice: '1.22400000', invoicedNetAmount: null }),
    );
    expect(within.findings).toEqual([]);
    const above = evaluateDeliveryVariance(
      input({ policy: tolerant, invoicedUnitPrice: '1.22400001', invoicedNetAmount: null }),
    );
    expect(above.findings[0]).toMatchObject({
      code: 'PRICE_ABOVE_RECEIPT_COST',
      severity: 'EXCEPTION',
    });
    const below = evaluateDeliveryVariance(
      input({ policy: tolerant, invoicedUnitPrice: '1.00000000', invoicedNetAmount: null }),
    );
    expect(below.findings[0]).toMatchObject({ code: 'PRICE_BELOW_RECEIPT_COST', severity: 'INFO' });
  });

  it('never treats a missing receipt cost as zero: the price check is skipped and says why', () => {
    const result = evaluateDeliveryVariance(
      input({ referenceUnitCost: null, invoicedUnitPrice: '99.00000000', invoicedNetAmount: null }),
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped.join(' ')).toMatch(/unpriced, not zero/);
  });

  it('compares the invoiced amount with what the received litres cost at the invoiced price', () => {
    const result = evaluateDeliveryVariance(input({ invoicedNetAmount: '1200.5000' }));
    expect(result.findings[0]).toMatchObject({
      code: 'AMOUNT_ABOVE_EXPECTED',
      difference: '0.5000',
    });
    const tolerant = evaluateDeliveryVariance(
      input({ invoicedNetAmount: '1200.5000', policy: { ...policy, amountTolerance: '0.5000' } }),
    );
    expect(tolerant.findings).toEqual([]);
  });

  it('flags over-receipt for review without making it an invoice-side exception', () => {
    const result = evaluateDeliveryVariance(
      input({
        noteQuantityLitres: '990.000',
        invoicedQuantityLitres: null,
        invoicedNetAmount: null,
        invoicedUnitPrice: null,
      }),
    );
    expect(result.findings[0]).toMatchObject({ code: 'OVER_RECEIPT', severity: 'EXCEPTION' });
    expect(result.exceeded).toBe(true);
    expect(result.invoiceExceeded).toBe(false);
    const allowed = evaluateDeliveryVariance(
      input({
        noteQuantityLitres: '990.000',
        invoicedQuantityLitres: null,
        invoicedNetAmount: null,
        invoicedUnitPrice: null,
        policy: { ...policy, overReceiptToleranceLitres: '10.000' },
      }),
    );
    expect(allowed.findings).toEqual([]);
  });

  it('carries the configured action so the caller can flag or require approval', () => {
    expect(evaluateDeliveryVariance(input()).action).toBe('FLAG');
    expect(
      evaluateDeliveryVariance(
        input({ policy: { ...policy, toleranceAction: 'REQUIRE_APPROVAL' } }),
      ).action,
    ).toBe('REQUIRE_APPROVAL');
  });
});

describe('price basis (purchase order versus receipt cost)', () => {
  it('judges against the PO price when linked and reports the basis', () => {
    // Receipt cost equals the invoice price, but the PO agreed a lower price.
    const result = evaluateDeliveryVariance(
      input({
        purchaseOrderUnitPrice: '1.10000000',
        purchaseOrderNumber: 'PO-7',
        invoicedNetAmount: null,
      }),
    );
    expect(result.priceBasis).toBe('PURCHASE_ORDER');
    expect(result.findings[0]).toMatchObject({
      code: 'PRICE_ABOVE_PO_PRICE',
      severity: 'EXCEPTION',
      difference: '0.10000000',
    });
    expect(result.findings[0]!.message).toContain('purchase order PO-7');
    expect(result.invoiceExceeded).toBe(true);
  });

  it('honours the price tolerance at the PO boundary and shows a lower price as information', () => {
    const tolerant = { ...policy, priceTolerancePercent: '2.0000' };
    const at = evaluateDeliveryVariance(
      input({
        policy: tolerant,
        purchaseOrderUnitPrice: '1.17647059',
        invoicedUnitPrice: '1.20000000',
        invoicedNetAmount: null,
      }),
    );
    expect(at.findings).toEqual([]);
    const below = evaluateDeliveryVariance(
      input({ purchaseOrderUnitPrice: '1.30000000', invoicedNetAmount: null }),
    );
    expect(below.findings[0]).toMatchObject({ code: 'PRICE_BELOW_PO_PRICE', severity: 'INFO' });
    expect(below.invoiceExceeded).toBe(false);
  });

  it('falls back to the receipt cost when unlinked or the PO line has no agreed price', () => {
    const unlinked = evaluateDeliveryVariance(input({ referenceUnitCost: '1.10000000' }));
    expect(unlinked.priceBasis).toBe('RECEIPT_COST');
    expect(unlinked.findings.some((item) => item.code === 'PRICE_ABOVE_RECEIPT_COST')).toBe(true);
    const unpriced = evaluateDeliveryVariance(
      input({ purchaseOrderUnitPrice: null, referenceUnitCost: '1.10000000' }),
    );
    expect(unpriced.priceBasis).toBe('RECEIPT_COST');
  });

  it('skips the check, never treating a missing price as zero, when no basis exists', () => {
    const result = evaluateDeliveryVariance(input({ referenceUnitCost: null }));
    expect(result.priceBasis).toBeNull();
    expect(result.skipped.join(' ')).toMatch(/unpriced, not zero/);
  });
});

describe('credit notes netting billed figures', () => {
  it('subtracts credited litres exactly and clamps at zero, reporting the excess', () => {
    expect(netBilledLitres('1000.300', '0.100')).toEqual({
      netLitres: '1000.200',
      creditExceedsInvoiced: false,
      unappliedCreditLitres: '0.000',
    });
    expect(netBilledLitres('400.000', '400.000').netLitres).toBe('0.000');
    expect(netBilledLitres('400.000', '450.500')).toEqual({
      netLitres: '0.000',
      creditExceedsInvoiced: true,
      unappliedCreditLitres: '50.500',
    });
  });

  it('nets amounts, floors at zero and stays unknown when the invoice states none', () => {
    expect(netBilledAmount('1200.0000', '300.0000')).toBe('900.0000');
    expect(netBilledAmount('1200.0000', null)).toBe('1200.0000');
    expect(netBilledAmount('100.0000', '250.0000')).toBe('0.0000');
    expect(netBilledAmount(null, '10.0000')).toBeNull();
  });

  it('lets a credit move a billed delivery back to partially billed or unbilled', () => {
    expect(
      classifyCoverage('1000.000', netBilledLitres('1000.000', '250.000').netLitres, true),
    ).toBe('PARTIALLY_BILLED');
    expect(
      classifyCoverage('1000.000', netBilledLitres('1000.000', '1000.000').netLitres, true),
    ).toBe('PARTIALLY_BILLED');
  });
});

describe('over-receipt assessment', () => {
  it('flags only beyond the over-receipt tolerance and honours the action', () => {
    const base = { noteQuantityLitres: '990.000', acceptedQuantityLitres: '1000.000' };
    expect(assessOverReceipt({ ...base, policy })).toMatchObject({
      flagged: true,
      excessLitres: '10.000',
      reviewRequired: false,
    });
    expect(
      assessOverReceipt({ ...base, policy: { ...policy, overReceiptToleranceLitres: '10.000' } })
        .flagged,
    ).toBe(false);
    expect(
      assessOverReceipt({ ...base, policy: { ...policy, overReceiptTolerancePercent: '1.0000' } })
        .flagged,
    ).toBe(true);
    expect(
      assessOverReceipt({ ...base, policy: { ...policy, overReceiptTolerancePercent: '1.1000' } })
        .flagged,
    ).toBe(false);
    expect(
      assessOverReceipt({ ...base, policy: { ...policy, toleranceAction: 'REQUIRE_APPROVAL' } })
        .reviewRequired,
    ).toBe(true);
  });

  it('never flags a short receipt', () => {
    expect(
      assessOverReceipt({
        noteQuantityLitres: '1000.000',
        acceptedQuantityLitres: '900.000',
        policy,
      }).flagged,
    ).toBe(false);
  });
});
