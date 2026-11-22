import { describe, expect, it } from 'vitest';
import {
  OTHER,
  allowanceChoices,
  applyAllowanceChoice,
  checkAllowance,
  checkChoice,
  checkPolicyReason,
  checkVatRate,
  currentAllowanceChoice,
  vatRateNeeded,
  type PolicyFormValues,
} from './policy-wizard-checks';

const empty: PolicyFormValues = {
  quantityToleranceLitres: '',
  quantityTolerancePercent: '',
  overReceiptToleranceLitres: '',
  overReceiptTolerancePercent: '',
  priceTolerancePercent: '',
  amountTolerance: '',
  toleranceAction: 'FLAG',
  vatMode: 'NONE',
  defaultVatRate: '',
  requireInvoiceLines: 'true',
  requireTransportBill: 'false',
};

describe('allowance answers', () => {
  it('offers "same as the company" to suppliers only', () => {
    const company = allowanceChoices('qty', true).map((o) => o.value);
    const supplier = allowanceChoices('qty', false).map((o) => o.value);
    expect(company).not.toContain('follow');
    expect(supplier).toContain('follow');
    expect(allowanceChoices('amount', true).map((o) => o.value)).toContain('u5');
    expect(allowanceChoices('price', true).map((o) => o.value)).toContain('p1');
  });

  it('reads an empty company allowance as "no difference" and an empty supplier one as "same as company"', () => {
    expect(currentAllowanceChoice('qty', empty, true)).toBe('none');
    expect(currentAllowanceChoice('qty', empty, false)).toBe('follow');
  });

  it('maps stored values to the ready-made answers, and anything else to "other"', () => {
    expect(currentAllowanceChoice('qty', { ...empty, quantityTolerancePercent: '0.5' }, true)).toBe(
      'p05',
    );
    expect(currentAllowanceChoice('price', { ...empty, priceTolerancePercent: '1' }, true)).toBe(
      'p1',
    );
    expect(currentAllowanceChoice('amount', { ...empty, amountTolerance: '5' }, true)).toBe('u5');
    expect(currentAllowanceChoice('qty', { ...empty, quantityToleranceLitres: '20' }, true)).toBe(
      OTHER,
    );
    expect(
      currentAllowanceChoice(
        'qty',
        { ...empty, quantityToleranceLitres: '0', quantityTolerancePercent: '0' },
        false,
      ),
    ).toBe('none');
  });

  it('turns an answer into form values', () => {
    expect(applyAllowanceChoice('qty', 'p1', true)).toEqual({
      quantityToleranceLitres: '',
      quantityTolerancePercent: '1',
    });
    expect(applyAllowanceChoice('qty', 'none', true)).toEqual({
      quantityToleranceLitres: '',
      quantityTolerancePercent: '',
    });
    // A supplier says zero so it does not follow the company.
    expect(applyAllowanceChoice('qty', 'none', false)).toEqual({
      quantityToleranceLitres: '0',
      quantityTolerancePercent: '0',
    });
    expect(applyAllowanceChoice('qty', 'follow', false)).toEqual({
      quantityToleranceLitres: '',
      quantityTolerancePercent: '',
    });
    expect(applyAllowanceChoice('amount', 'u1', true)).toEqual({ amountTolerance: '1' });
    expect(applyAllowanceChoice('price', OTHER, true)).toEqual({});
  });
});

describe('policy checks', () => {
  it('accepts plain numbers or nothing, within the decimal places', () => {
    expect(checkAllowance('qty', empty)).toEqual({});
    expect(checkAllowance('qty', { ...empty, quantityToleranceLitres: '12.5' })).toEqual({});
    expect(checkAllowance('qty', { ...empty, quantityToleranceLitres: '1.2345' })).toHaveProperty(
      'pp-qty-l',
    );
    expect(checkAllowance('price', { ...empty, priceTolerancePercent: 'abc' })).toHaveProperty(
      'pp-price',
    );
    expect(checkAllowance('amount', { ...empty, amountTolerance: '1,000' })).toEqual({});
  });

  it('needs a VAT rate only when VAT is shown', () => {
    expect(vatRateNeeded('')).toBe(false);
    expect(vatRateNeeded('NONE')).toBe(false);
    expect(vatRateNeeded('EXCLUSIVE')).toBe(true);
    expect(checkVatRate({ ...empty, vatMode: 'EXCLUSIVE' })).toHaveProperty('pp-vat-rate');
    expect(checkVatRate({ ...empty, vatMode: 'EXCLUSIVE', defaultVatRate: '15' })).toEqual({});
    expect(checkVatRate({ ...empty, vatMode: 'NONE' })).toEqual({});
  });

  it('needs a reason, and an answer from a supplier', () => {
    expect(checkPolicyReason(' ')).toHaveProperty('pp-reason');
    expect(checkPolicyReason('New terms')).toEqual({});
    expect(checkChoice('pp-action', '', true)).toEqual({});
    expect(checkChoice('pp-action', '', false)).toHaveProperty('pp-action');
    expect(checkChoice('pp-action', 'FLAG', false)).toEqual({});
  });
});
