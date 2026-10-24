import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PURCHASING_POLICY,
  assertHeaderMatchesLines,
  computeInvoiceLine,
  resolvePurchasingPolicy,
  sumInvoiceLines,
  validatePurchasingPolicyValues,
  type PurchasingPolicyValues,
} from './purchasing-policy';

const none: Pick<PurchasingPolicyValues, 'vatMode' | 'defaultVatRate' | 'productVatRates'> = {
  vatMode: 'NONE',
  defaultVatRate: null,
  productVatRates: {},
};
// The rates below are test inputs only; the product never hard-codes a rate.
const exclusive = { vatMode: 'EXCLUSIVE' as const, defaultVatRate: '15.0000', productVatRates: {} };
const inclusive = { vatMode: 'INCLUSIVE' as const, defaultVatRate: '15.0000', productVatRates: {} };

describe('purchasing policy resolution', () => {
  it('is strict, VAT-free and line-requiring until a policy is configured', () => {
    const resolved = resolvePurchasingPolicy(null, null);
    expect(resolved).toMatchObject({
      source: 'DEFAULT',
      vatMode: 'NONE',
      toleranceAction: 'FLAG',
      requireInvoiceLines: true,
      quantityToleranceLitres: null,
      priceTolerancePercent: null,
    });
  });

  it('lets a supplier override inherit every field it leaves unset, including an explicit zero', () => {
    const tenant: PurchasingPolicyValues = {
      ...BUILT_IN_PURCHASING_POLICY,
      quantityToleranceLitres: '5.000',
      priceTolerancePercent: '2.0000',
      vatMode: 'EXCLUSIVE',
      defaultVatRate: '10.0000',
      requireInvoiceLines: false,
    };
    const resolved = resolvePurchasingPolicy(tenant, {
      quantityToleranceLitres: '0.000',
      toleranceAction: 'REQUIRE_APPROVAL',
    });
    expect(resolved.source).toBe('SUPPLIER_OVERRIDE');
    expect(resolved.quantityToleranceLitres).toBe('0.000');
    expect(resolved.priceTolerancePercent).toBe('2.0000');
    expect(resolved.toleranceAction).toBe('REQUIRE_APPROVAL');
    expect(resolved.vatMode).toBe('EXCLUSIVE');
    expect(resolved.requireInvoiceLines).toBe(false);
  });
});

describe('purchasing policy validation', () => {
  it('normalizes exact decimals and rejects negatives, excess scale and percent over 100', () => {
    const ok = validatePurchasingPolicyValues({
      quantityToleranceLitres: '0.1',
      priceTolerancePercent: '0.5',
      amountTolerance: '2',
      vatMode: 'EXCLUSIVE',
      defaultVatRate: '15',
    });
    expect(ok.quantityToleranceLitres).toBe('0.100');
    expect(ok.priceTolerancePercent).toBe('0.5000');
    expect(ok.amountTolerance).toBe('2.0000');
    expect(() => validatePurchasingPolicyValues({ quantityToleranceLitres: '-1' })).toThrow(
      /cannot be negative/,
    );
    expect(() => validatePurchasingPolicyValues({ quantityToleranceLitres: '1.0001' })).toThrow(
      /at most 3 decimal places/,
    );
    expect(() => validatePurchasingPolicyValues({ priceTolerancePercent: '100.01' })).toThrow(
      /cannot be more than 100/,
    );
    expect(() => validatePurchasingPolicyValues({ vatMode: 'SOMETIMES' })).toThrow(/VAT mode/);
    expect(() => validatePurchasingPolicyValues({ toleranceAction: 'IGNORE' })).toThrow(/FLAG/);
  });
});

describe('invoice line arithmetic', () => {
  it('multiplies exactly (0.1 x 0.2 is 0.02, not 0.020000000000000004)', () => {
    const line = computeInvoiceLine(
      { description: 'x', quantity: '0.100', unitPrice: '0.2' },
      1,
      none,
    );
    expect(line.netAmount).toBe('0.0200');
    expect(line.grossAmount).toBe('0.0200');
    expect(line.vatAmount).toBe('0.0000');
  });

  it('rounds the extension half-up to 4 decimal places at one boundary', () => {
    const line = computeInvoiceLine(
      { description: 'x', quantity: '1.000', unitPrice: '0.00005' },
      1,
      none,
    );
    expect(line.netAmount).toBe('0.0001');
  });

  it('EXCLUSIVE: the printed amount is net and VAT is added, rounded half-up', () => {
    const line = computeInvoiceLine(
      { description: 'x', quantity: '1', unitPrice: '1.0005', vatRate: '10' },
      1,
      exclusive,
    );
    expect(line.netAmount).toBe('1.0005');
    expect(line.vatAmount).toBe('0.1001');
    expect(line.grossAmount).toBe('1.1006');
  });

  it('INCLUSIVE: the printed amount is gross and net is derived so net + VAT is exact', () => {
    const line = computeInvoiceLine(
      { description: 'x', quantity: '1', unitPrice: '100' },
      1,
      inclusive,
    );
    expect(line.grossAmount).toBe('100.0000');
    expect(line.netAmount).toBe('86.9565');
    expect(line.vatAmount).toBe('13.0435');
    expect(Number(line.netAmount) + Number(line.vatAmount)).toBeCloseTo(100, 10);
    const whole = computeInvoiceLine(
      { description: 'x', quantity: '1', unitPrice: '115' },
      1,
      inclusive,
    );
    expect(whole.netAmount).toBe('100.0000');
    expect(whole.vatAmount).toBe('15.0000');
  });

  it('uses a stated VAT amount over the computed one, in both modes', () => {
    const ex = computeInvoiceLine(
      { description: 'x', quantity: '1', unitPrice: '10', vatAmount: '1.4900' },
      1,
      exclusive,
    );
    expect(ex.vatAmount).toBe('1.4900');
    expect(ex.grossAmount).toBe('11.4900');
    const inc = computeInvoiceLine(
      { description: 'x', quantity: '1', unitPrice: '10', vatAmount: '1.3000' },
      1,
      inclusive,
    );
    expect(inc.netAmount).toBe('8.7000');
    expect(inc.grossAmount).toBe('10.0000');
  });

  it('resolves the rate: line rate, then product override, then default', () => {
    const policy = {
      vatMode: 'EXCLUSIVE' as const,
      defaultVatRate: '10.0000',
      productVatRates: { p1: '0.0000', p2: '5.0000' },
    };
    const base = { description: 'x', quantity: '1', unitPrice: '100' };
    expect(computeInvoiceLine({ ...base, productId: 'p1' }, 1, policy).vatAmount).toBe('0.0000');
    expect(computeInvoiceLine({ ...base, productId: 'p2' }, 1, policy).vatAmount).toBe('5.0000');
    expect(computeInvoiceLine({ ...base, productId: 'p3' }, 1, policy).vatAmount).toBe('10.0000');
    expect(
      computeInvoiceLine({ ...base, productId: 'p2', vatRate: '20' }, 1, policy).vatAmount,
    ).toBe('20.0000');
  });

  it('refuses VAT when the policy has none, and a missing rate when it has VAT', () => {
    expect(() =>
      computeInvoiceLine(
        { description: 'x', quantity: '1', unitPrice: '1', vatAmount: '0.15' },
        2,
        none,
      ),
    ).toThrow(/Line 2 has VAT, but VAT is switched off/);
    expect(() =>
      computeInvoiceLine({ description: 'x', quantity: '1', unitPrice: '1' }, 3, {
        vatMode: 'EXCLUSIVE',
        defaultVatRate: null,
        productVatRates: {},
      }),
    ).toThrow(/Line 3 needs a VAT rate/);
  });

  it('rejects empty descriptions, zero quantity and over-precise input', () => {
    expect(() =>
      computeInvoiceLine({ description: ' ', quantity: '1', unitPrice: '1' }, 1, none),
    ).toThrow(/needs a description/);
    expect(() =>
      computeInvoiceLine({ description: 'x', quantity: '0', unitPrice: '1' }, 1, none),
    ).toThrow(/greater than zero/);
    expect(() =>
      computeInvoiceLine({ description: 'x', quantity: '1.0001', unitPrice: '1' }, 1, none),
    ).toThrow(/at most 3 decimal places/);
  });
});

describe('header agreement', () => {
  const lines = [
    computeInvoiceLine({ description: 'a', quantity: '10', unitPrice: '1.1' }, 1, exclusive),
    computeInvoiceLine({ description: 'b', quantity: '1', unitPrice: '0.3' }, 2, exclusive),
  ];
  const totals = sumInvoiceLines(lines);

  it('sums rounded line figures exactly', () => {
    expect(totals).toEqual({ net: '11.3000', vat: '1.6950', gross: '12.9950' });
  });

  it('accepts an exact header and rejects any difference with a plain message', () => {
    expect(() => assertHeaderMatchesLines({ amount: '12.9950' }, totals)).not.toThrow();
    expect(() =>
      assertHeaderMatchesLines(
        { amount: '12.9950', netAmount: '11.3', vatAmount: '1.695' },
        totals,
      ),
    ).not.toThrow();
    expect(() => assertHeaderMatchesLines({ amount: '13.0000' }, totals)).toThrow(
      /total is 13\.0000 but its lines add up to 12\.9950/,
    );
    expect(() => assertHeaderMatchesLines({ amount: '12.9950', vatAmount: '1.7' }, totals)).toThrow(
      /VAT is 1\.7000/,
    );
  });
});
