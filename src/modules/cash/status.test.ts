import { describe, expect, it } from 'vitest';
import {
  bankingStatusForDeposit,
  cashStatusForCustody,
  cashStatusForLocationType,
  cashStatusLabelForCustody,
  deriveCashStatus,
  depositProofFlags,
  depositProofSummary,
  shortageReasonMissing,
} from './status';

describe('cash status names', () => {
  it('maps every stored custody state to a plain name', () => {
    expect(cashStatusLabelForCustody('AT_STATION')).toBe('At the station');
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
    expect(deriveCashStatus(base)).toBe('AT_STATION');
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
    expect(cashStatusForLocationType('TRANSIT')).toBe('IN_TRANSIT');
    expect(cashStatusForLocationType('COLLECTOR')).toBe('HELD_BY_MANAGEMENT');
    expect(cashStatusForLocationType('OTHER')).toBeNull();
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
