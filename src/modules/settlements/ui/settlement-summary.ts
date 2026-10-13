import { exact, sumExact } from '@/modules/reporting/domain';

import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from '../contracts';

/**
 * Presentation summaries for the settlements page. Amounts are summed with
 * exact decimals from the rows the server returned; nothing is estimated.
 */

const METHOD_LABELS: Record<UnmatchedProviderPaymentRow['method'], string> = {
  ECOCASH: 'EcoCash',
  POS: 'POS (card)',
};

export function methodLabel(method: UnmatchedProviderPaymentRow['method']): string {
  return METHOD_LABELS[method] ?? method;
}

const STATE_LABELS: Record<ProviderSettlementSummaryRow['state'], string> = {
  RECORDED: 'Recorded',
  PARTIALLY_MATCHED: 'Partly matched',
  RECONCILED: 'Reconciled',
  EXCEPTION: 'Exception',
};

export function settlementStateLabel(state: ProviderSettlementSummaryRow['state']): string {
  return STATE_LABELS[state] ?? state;
}

export type MethodTotal = { method: string; label: string; count: number; remaining: string };

/** Payment evidence still waiting to be matched, per method (EcoCash, POS). */
export function methodTotals(rows: readonly UnmatchedProviderPaymentRow[]): MethodTotal[] {
  const methods = (['ECOCASH', 'POS'] as const).filter((method) =>
    rows.some((row) => row.method === method),
  );
  return methods.map((method) => {
    const matching = rows.filter((row) => row.method === method);
    return {
      method,
      label: methodLabel(method),
      count: matching.length,
      remaining: sumExact(matching.map((row) => row.unallocatedAmount)),
    };
  });
}

export function settlementCounts(rows: readonly ProviderSettlementSummaryRow[]) {
  return {
    open: rows.filter((row) => row.state !== 'RECONCILED').length,
    exceptions: rows.filter((row) => row.state === 'EXCEPTION').length,
  };
}

export type ProviderShare = {
  key: string;
  name: string;
  currency: string;
  gross: string;
  share: number;
};

/** Gross settled per provider, with each provider's share of the total for the chart. */
export function providerShares(rows: readonly ProviderSettlementSummaryRow[]): ProviderShare[] {
  const keys = [...new Set(rows.map((row) => `${row.providerName}|${row.currency}`))];
  const groups = keys.map((key) => {
    const matching = rows.filter((row) => `${row.providerName}|${row.currency}` === key);
    const first = matching[0] as ProviderSettlementSummaryRow;
    return {
      key,
      name: first.providerName,
      currency: first.currency,
      gross: sumExact(matching.map((row) => row.grossAmount)),
    };
  });
  // Shares are only meaningful within one currency.
  return groups
    .map((group) => {
      const total = exact(
        sumExact(groups.filter((other) => other.currency === group.currency).map((g) => g.gross)),
      ).value;
      return {
        ...group,
        share: total.isZero() ? 0 : exact(group.gross).value.dividedBy(total).toNumber(),
      };
    })
    .sort((left, right) => right.share - left.share);
}
