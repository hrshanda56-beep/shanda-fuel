import { describe, expect, it } from 'vitest';
import {
  checkBankAccountPick,
  checkBankFrom,
  checkBankLine,
  checkBankLinesDistinct,
  checkBankReference,
  checkCollectAmount,
  checkCollectReference,
  checkCollectShift,
  checkCollectWhere,
  checkConfirmAmount,
  checkConfirmDate,
  checkConfirmReason,
  checkConfirmReference,
  checkReceiveCash,
  checkReceiveWhere,
  cleanAmount,
  confirmDiffers,
  scaledAmount,
} from './cash-sheet-checks';

describe('amounts', () => {
  it('reads plain decimals exactly', () => {
    expect(scaledAmount('1500')).toBe(15_000_000n);
    expect(scaledAmount('1,500.5')).toBe(15_005_000n);
    expect(scaledAmount('0.0001')).toBe(1n);
    expect(scaledAmount('abc')).toBeNull();
    expect(scaledAmount('-1')).toBeNull();
    expect(scaledAmount('1.00001')).toBeNull();
    expect(cleanAmount(' 1,250.50 ')).toBe('1250.50');
  });
});

describe('collect cash checks', () => {
  it('needs a shift, a place, an amount within what is available, and a reference', () => {
    expect(checkCollectShift('')).toHaveProperty('collect-shift');
    expect(checkCollectShift('r1')).toEqual({});
    expect(checkCollectWhere('')).toHaveProperty('collect-where');
    expect(checkCollectAmount('', '100')).toHaveProperty('collect-amount');
    expect(checkCollectAmount('x', '100')).toHaveProperty('collect-amount');
    expect(checkCollectAmount('0', '100')).toHaveProperty('collect-amount');
    expect(checkCollectAmount('100.01', '100')).toHaveProperty('collect-amount');
    expect(checkCollectAmount('100', '100')).toEqual({});
    expect(checkCollectReference(' ')).toHaveProperty('collect-reference');
    expect(checkCollectReference('COL-1')).toEqual({});
  });
});

describe('receive cash checks', () => {
  it('needs the cash and where it arrived', () => {
    expect(checkReceiveCash('')).toHaveProperty('receive-cash');
    expect(checkReceiveWhere('')).toHaveProperty('receive-where');
    expect(checkReceiveCash('c1')).toEqual({});
    expect(checkReceiveWhere('l1')).toEqual({});
  });
});

describe('bank cash checks', () => {
  it('needs an account, a place, valid lines and a reference', () => {
    expect(checkBankAccountPick('')).toHaveProperty('bank-account');
    expect(checkBankFrom('')).toHaveProperty('bank-from');
    expect(checkBankReference(' ')).toHaveProperty('bank-reference');
    expect(checkBankReference('SLIP-9')).toEqual({});
    expect(checkBankLine({ collectionId: '', amount: '5' }, '10')).toHaveProperty('bank-cash');
    expect(checkBankLine({ collectionId: 'c', amount: '11' }, '10')).toHaveProperty('bank-amount');
    expect(checkBankLine({ collectionId: 'c', amount: '10' }, '10')).toEqual({});
  });

  it('does not allow the same cash twice', () => {
    const line = { collectionId: 'c1', amount: '5' };
    expect(checkBankLinesDistinct([line, { ...line, collectionId: 'c2' }])).toEqual({});
    expect(checkBankLinesDistinct([line, line])).toHaveProperty('bank-cash');
  });
});

describe('confirm deposit checks', () => {
  it('needs an amount and a bank reference, and no future date', () => {
    expect(checkConfirmAmount('')).toHaveProperty('confirm-amount');
    expect(checkConfirmAmount('50')).toEqual({});
    expect(checkConfirmReference('')).toHaveProperty('confirm-reference');
    expect(checkConfirmDate('', '2026-11-21')).toEqual({});
    expect(checkConfirmDate('2026-11-22', '2026-11-21')).toHaveProperty('confirm-date');
    expect(checkConfirmDate('2026-11-21', '2026-11-21')).toEqual({});
  });

  it('asks why only when the bank shows a different amount', () => {
    expect(confirmDiffers('50.00', '50')).toBe(false);
    expect(confirmDiffers('50', '49.99')).toBe(true);
    expect(checkConfirmReason('50', '50', '')).toEqual({});
    expect(checkConfirmReason('50', '49', '')).toHaveProperty('confirm-reason');
    expect(checkConfirmReason('50', '49', 'Bank fee')).toEqual({});
  });
});
