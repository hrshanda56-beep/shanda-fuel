import { describe, expect, it } from 'vitest';

import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from '../contracts';
import {
  methodTotals,
  providerShares,
  settlementCounts,
  settlementStateLabel,
} from './settlement-summary';

const payment = (method: 'POS' | 'ECOCASH', unallocatedAmount: string) =>
  ({ method, unallocatedAmount }) as UnmatchedProviderPaymentRow;

const settlement = (
  providerName: string,
  grossAmount: string,
  state: ProviderSettlementSummaryRow['state'] = 'RECORDED',
  currency = 'USD',
) => ({ providerName, grossAmount, state, currency }) as ProviderSettlementSummaryRow;

describe('methodTotals', () => {
  it('sums what is waiting per method with exact decimals, EcoCash first', () => {
    expect(
      methodTotals([payment('POS', '0.1'), payment('ECOCASH', '10'), payment('POS', '0.2')]),
    ).toEqual([
      { method: 'ECOCASH', label: 'EcoCash', count: 1, remaining: '10' },
      { method: 'POS', label: 'POS (card)', count: 2, remaining: '0.3' },
    ]);
    expect(methodTotals([])).toEqual([]);
  });
});

describe('settlementCounts and labels', () => {
  it('counts open settlements and exceptions', () => {
    expect(
      settlementCounts([
        settlement('EcoCash', '1', 'RECONCILED'),
        settlement('EcoCash', '1', 'EXCEPTION'),
        settlement('CBZ', '1', 'PARTIALLY_MATCHED'),
      ]),
    ).toEqual({ open: 2, exceptions: 1 });
    expect(settlementStateLabel('PARTIALLY_MATCHED')).toBe('Partly matched');
  });
});

describe('providerShares', () => {
  it('groups gross by provider and orders by share', () => {
    const shares = providerShares([
      settlement('EcoCash', '25'),
      settlement('CBZ POS', '50'),
      settlement('EcoCash', '25'),
    ]);
    expect(shares.map((share) => [share.name, share.gross, share.share])).toEqual([
      ['EcoCash', '50', 0.5],
      ['CBZ POS', '50', 0.5],
    ]);
  });

  it('keeps shares within one currency', () => {
    const shares = providerShares([
      settlement('EcoCash', '10'),
      settlement('OneMoney', '5', 'RECORDED', 'ZWG'),
    ]);
    expect(shares.every((share) => share.share === 1)).toBe(true);
  });
});
