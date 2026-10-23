import { exact, sumExact } from '@/modules/reporting/domain';

import { settlementRecordLabel } from '../status';
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

export function settlementStateLabel(state: ProviderSettlementSummaryRow['state']): string {
  return settlementRecordLabel(state);
}

export type MethodTotal = {
  method: string;
  label: string;
  count: number;
  overdueCount: number;
  remaining: string;
};

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
      overdueCount: matching.filter((row) => row.overdue).length,
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

/** Share of a settlement's gross already matched to payment evidence, 0 to 100. Drawing only. */
export function allocatedPercent(row: ProviderSettlementSummaryRow): number {
  const gross = exact(row.grossAmount).value;
  if (!gross.greaterThan(0)) return 0;
  const share = exact(row.allocatedAmount).value.dividedBy(gross).times(100).toNumber();
  return Math.min(100, Math.max(0, Math.round(share)));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** Whether a provider (by its name or code) is the one that pays out this kind of payment. */
export function providerMatchesMethod(
  row: Pick<ProviderSettlementSummaryRow, 'providerName' | 'providerCode'>,
  method: UnmatchedProviderPaymentRow['method'],
): boolean {
  const isEco = /eco\s*-?\s*cash/i.test(`${row.providerName} ${row.providerCode}`);
  return method === 'ECOCASH' ? isEco : !isEco;
}

function stillOpen(row: ProviderSettlementSummaryRow): boolean {
  return row.state !== 'RECONCILED' && /[1-9]/.test(row.unallocatedProviderAmount);
}

/** The payout to suggest for a payment: still open, same provider kind first. */
export function pickSettlementFor(
  payment: Pick<UnmatchedProviderPaymentRow, 'method'> | undefined,
  rows: readonly ProviderSettlementSummaryRow[],
): ProviderSettlementSummaryRow | undefined {
  const open = rows.filter(stillOpen);
  if (open.length === 1) return open[0];
  const preferred = payment ? open.filter((row) => providerMatchesMethod(row, payment.method)) : [];
  return (preferred.length > 0 ? preferred : open)[0];
}

/** Payments that belong with the chosen payout first, otherwise the order given. */
export function orderPaymentsFor<T extends Pick<UnmatchedProviderPaymentRow, 'method'>>(
  settlement: Pick<ProviderSettlementSummaryRow, 'providerName' | 'providerCode'> | undefined,
  payments: readonly T[],
): T[] {
  if (!settlement) return [...payments];
  const same = payments.filter((row) => providerMatchesMethod(settlement, row.method));
  return [...same, ...payments.filter((row) => !same.includes(row))];
}
