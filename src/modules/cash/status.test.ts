import { describe, expect, it } from 'vitest';
import {
  bankingStatusForDeposit,
  cashStatusForCustody,
  cashStatusForLocationType,
  cashStatusLabel,
  cashStatusLabelForCustody,
  deriveCashStatus,
  depositProofFlags,
  depositProofSummary,
  shortageReasonMissing,
} from './status';

describe('cash status names', () => {
  it('maps every stored custody state to a plain name', () => {
    expect(cashStatusLabelForCustody('AT_STATION')).toBe('Collected, not banked yet');
    expect(cashStatusLabelForCustody('RECEIVED')).toBe('Held by management');
    expect(cashStatusLabelForCustody('IN_TRANSIT')).toBe('On its way to the bank');
    expect(cashStatusLabelForCustody('PARTIALLY_DEPOSITED')).toBe('Partly banked');
    expect(cashStatusLabelForCustody('BANKED')).toBe('Fully banked');
  });

  it('never hides an unknown state', () => {
    expect(cashStatusForCustody('SOMETHING_NEW')).toBeNull();
    expect(cashStatusLabelForCustody('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('derives the status from exact amounts', () => {
    const base = {
      amount: '100.0000',
      allocatedAmount: '0',
      confirmedAmount: '0',
      received: false,
    };
    expect(deriveCashStatus(base)).toBe('COLLECTED');
    expect(deriveCashStatus({ ...base, received: true })).toBe('HELD_BY_MANAGEMENT');
    expect(deriveCashStatus({ ...base, allocatedAmount: '100' })).toBe('IN_TRANSIT');
    expect(deriveCashStatus({ ...base, allocatedAmount: '99.9999' })).toBe('PARTLY_BANKED');
    expect(deriveCashStatus({ ...base, allocatedAmount: '100', confirmedAmount: '0.0001' })).toBe(
      'PARTLY_BANKED',
    );
    expect(deriveCashStatus({ ...base, allocatedAmount: '100', confirmedAmount: '100.0000' })).toBe(
      'FULLY_BANKED',
    );
  });

  it('names where a handover leaves the cash', () => {
    expect(cashStatusForLocationType('STATION_SAFE')).toBe('AT_STATION');
    expect(cashStatusLabel('AT_STATION')).toBe('Still at the station');
    expect(cashStatusForLocationType('TRANSIT')).toBe('IN_TRANSIT');
    expect(cashStatusForLocationType('COLLECTOR')).toBe('HELD_BY_MANAGEMENT');
    expect(cashStatusForLocationType('OTHER')).toBeNull();
  });

  it('never counts collected cash as banked', () => {
    // Every state short of a bank-confirmed deposit is a different status from Fully banked.
    const base = { amount: '100', allocatedAmount: '0', confirmedAmount: '0', received: false };
    expect(deriveCashStatus(base)).not.toBe('FULLY_BANKED');
    expect(deriveCashStatus({ ...base, received: true })).not.toBe('FULLY_BANKED');
    expect(deriveCashStatus({ ...base, allocatedAmount: '100' })).not.toBe('FULLY_BANKED');
    expect(deriveCashStatus({ ...base, allocatedAmount: '100', confirmedAmount: '100' })).toBe(
      'FULLY_BANKED',
    );
    // The six names a person sees, in plain words.
    expect(
      [
        'AT_STATION',
        'COLLECTED',
        'IN_TRANSIT',
        'HELD_BY_MANAGEMENT',
        'PARTLY_BANKED',
        'FULLY_BANKED',
      ].map((key) => cashStatusLabel(key as never)),
    ).toEqual([
      'Still at the station',
      'Collected, not banked yet',
      'On its way to the bank',
      'Held by management',
      'Partly banked',
      'Fully banked',
    ]);
  });

  it('names the banking status of a deposit', () => {
    expect(
      bankingStatusForDeposit({ state: 'RECORDED', amount: '10', confirmedAmount: null }),
    ).toBe('On its way to the bank');
    expect(
      bankingStatusForDeposit({ state: 'CONFIRMED', amount: '10.0000', confirmedAmount: '10' }),
    ).toBe('Fully banked');
    expect(
      bankingStatusForDeposit({ state: 'CONFIRMED', amount: '10', confirmedAmount: '9.5' }),
    ).toBe('Partly banked');
    expect(
      bankingStatusForDeposit({ state: 'REJECTED', amount: '10', confirmedAmount: null }),
    ).toBe('Rejected by the bank');
    expect(
      bankingStatusForDeposit({ state: 'ODD', amount: '10', confirmedAmount: null }),
    ).toBeNull();
  });
});

describe('missing proof and reference are warnings only', () => {
  it('flags a deposit with no slip and no reference', () => {
    const flags = depositProofFlags({ slipCount: 0, bankReference: null });
    expect(flags).toEqual({ missingProof: true, missingBankReference: true });
    expect(depositProofSummary(flags)).toBe('No deposit slip attached; No bank reference yet');
  });

  it('flags nothing when both exist, and treats blank as missing', () => {
    expect(depositProofSummary(depositProofFlags({ slipCount: 1, bankReference: 'BR-1' }))).toBe(
      '',
    );
    expect(depositProofFlags({ slipCount: 2, bankReference: '   ' }).missingBankReference).toBe(
      true,
    );
  });
});

describe('shortage reason', () => {
  it('is missing only for a shortage with no written reason', () => {
    expect(shortageReasonMissing({ variance: '-5.0000', reason: null })).toBe(true);
    expect(shortageReasonMissing({ variance: '-5', reason: ' ' })).toBe(true);
    expect(shortageReasonMissing({ variance: '-5', reason: 'Till error' })).toBe(false);
    expect(shortageReasonMissing({ variance: '5', reason: null })).toBe(false);
    expect(shortageReasonMissing({ variance: null, reason: null })).toBe(false);
  });
});
