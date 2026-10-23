import { describe, expect, it } from 'vitest';

import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from '../contracts';
import {
  methodTotals,
  orderPaymentsFor,
  pickSettlementFor,
  providerShares,
  settlementCounts,
  settlementStateLabel,
} from './settlement-summary';

const payment = (method: 'POS' | 'ECOCASH', unallocatedAmount: string, overdue = false) =>
  ({ method, unallocatedAmount, overdue }) as UnmatchedProviderPaymentRow;

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
      { method: 'ECOCASH', label: 'EcoCash', count: 1, overdueCount: 0, remaining: '10' },
      { method: 'POS', label: 'POS (card)', count: 2, overdueCount: 0, remaining: '0.3' },
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
    expect(settlementStateLabel('PARTIALLY_MATCHED')).toBe('Partly settled');
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

describe('matching suggestions', () => {
  const eco = {
    ...settlement('EcoCash', '10'),
    providerCode: 'ECOCASH',
    unallocatedProviderAmount: '10',
    settlementId: 'a',
  };
  const cbz = {
    ...settlement('CBZ POS', '10'),
    providerCode: 'CBZ',
    unallocatedProviderAmount: '10',
    settlementId: 'b',
  };
  const done = {
    ...settlement('CBZ POS', '10', 'RECONCILED'),
    providerCode: 'CBZ',
    unallocatedProviderAmount: '0',
    settlementId: 'c',
  };

  it('picks the only open payout, otherwise the one for the same provider', () => {
    expect(pickSettlementFor(payment('POS', '1'), [done, eco])?.settlementId).toBe('a');
    expect(pickSettlementFor(payment('POS', '1'), [eco, cbz])?.settlementId).toBe('b');
    expect(pickSettlementFor(payment('ECOCASH', '1'), [cbz, eco])?.settlementId).toBe('a');
    expect(pickSettlementFor(payment('POS', '1'), [done])).toBeUndefined();
  });

  it('lists payments for the chosen provider first', () => {
    const rows = [payment('POS', '1'), payment('ECOCASH', '2')];
    expect(orderPaymentsFor(eco, rows).map((row) => row.method)).toEqual(['ECOCASH', 'POS']);
    expect(orderPaymentsFor(undefined, rows)).toEqual(rows);
  });
});

describe('settlement wording', () => {
  it('uses the shared plain status names', () => {
    expect(settlementStateLabel('RECORDED')).toBe('Awaiting settlement');
    expect(settlementStateLabel('RECONCILED')).toBe('Settled');
    expect(settlementStateLabel('EXCEPTION')).toBe('Settled with a difference');
  });
});

describe('overdue count', () => {
  it('counts the overdue payments for each method', () => {
    const totals = methodTotals([
      payment('POS', '1', true),
      payment('POS', '2'),
      payment('ECOCASH', '3'),
    ]);
    expect(totals.find((row) => row.method === 'POS')?.overdueCount).toBe(1);
    expect(totals.find((row) => row.method === 'ECOCASH')?.overdueCount).toBe(0);
  });
});
