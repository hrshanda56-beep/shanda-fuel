import { describe, expect, it } from 'vitest';
import {
  calculateBankDepositAmount,
  calculateCashCollectionAmount,
  calculateProviderSettlement,
  cashBalanceForLocation,
  remainingCashAmount,
  submitCashHandover,
  transitionCashHandover,
  validateCashMovement,
} from './domain';

describe('cash custody domain', () => {
  it('conserves cash across a receipt, transfer, and disbursement', () => {
    const movements = [
      { movementType: 'RECEIPT' as const, amount: '100.00', toLocationId: 'till' },
      {
        movementType: 'TRANSFER' as const,
        amount: '40.00',
        fromLocationId: 'till',
        toLocationId: 'safe',
      },
      { movementType: 'DISBURSEMENT' as const, amount: '10.00', fromLocationId: 'safe' },
    ];

    expect(cashBalanceForLocation('till', movements)).toBe('60');
    expect(cashBalanceForLocation('safe', movements)).toBe('30');
  });

  it('rejects a transfer that omits one side', () => {
    expect(() =>
      validateCashMovement({ movementType: 'TRANSFER', amount: '1', fromLocationId: 'till' }),
    ).toThrow('both locations');
  });

  it('marks a handover with a mismatch as disputed without losing the signed variance', () => {
    const handover = submitCashHandover({ expectedAmount: '100.00', countedAmount: '98.50' });
    expect(handover).toMatchObject({ state: 'DISPUTED', variance: '-1.5' });
    expect(transitionCashHandover('DISPUTED', 'ResolveCashHandover')).toBe('RESOLVED');
  });

  it('does not equate a deposit with bank confirmation', () => {
    expect(transitionCashHandover('SUBMITTED', 'AcceptCashHandover')).toBe('ACCEPTED');
    expect(() => transitionCashHandover('DRAFT', 'AcceptCashHandover')).toThrow('DRAFT state');
  });

  it('supports partial collection from one reconciliation without binary arithmetic', () => {
    expect(
      calculateCashCollectionAmount([
        { reconciliationId: 'r1', amount: '100.10', availableAmount: '150.25' },
        { reconciliationId: 'r2', amount: '0.20', availableAmount: '1.00' },
      ]),
    ).toBe('100.3');
    expect(remainingCashAmount('150.25', '100.10')).toBe('50.15');
  });

  it('rejects collection and deposit over-allocation', () => {
    expect(() =>
      calculateCashCollectionAmount([
        { reconciliationId: 'r1', amount: '100.01', availableAmount: '100.00' },
      ]),
    ).toThrow('exceeds the reconciliation cash');
    expect(() =>
      calculateBankDepositAmount([
        { collectionId: 'c1', amount: '75.01', unbankedAmount: '75.00' },
      ]),
    ).toThrow('exceeds the collection amount');
  });

  it('derives a deposit total from multiple collection allocations', () => {
    expect(
      calculateBankDepositAmount([
        { collectionId: 'c1', amount: '75.00', unbankedAmount: '75.00' },
        { collectionId: 'c2', amount: '25.25', unbankedAmount: '100.00' },
      ]),
    ).toBe('100.25');
  });
});

describe('provider settlement domain', () => {
  it('keeps provider fees outside station shortage variance', () => {
    expect(
      calculateProviderSettlement({
        declaredGross: '1000',
        declaredFees: '12.50',
        declaredRefunds: '7.50',
        settledNet: '975',
      }),
    ).toMatchObject({ expectedNet: '980', variance: '-5' });
  });

  it('rejects deductions larger than gross', () => {
    expect(() =>
      calculateProviderSettlement({
        declaredGross: '10',
        declaredFees: '8',
        declaredRefunds: '3',
        settledNet: '0',
      }),
    ).toThrow('cannot exceed declared gross');
  });
});
