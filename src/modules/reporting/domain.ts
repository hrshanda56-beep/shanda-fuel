import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import type { ManagementReport } from './contracts';

export type ReportingAttentionItem = Readonly<{
  id:
    | 'cash-variance'
    | 'cash-awaiting-collection'
    | 'cash-awaiting-banking'
    | 'provider-unmatched-evidence'
    | 'provider-unallocated-settlement'
    | 'provider-settlement-variance'
    | 'inventory-variance'
    | 'gross-margin-unavailable';
  priority: 'warning' | 'info';
  title: string;
  detail: string;
  meta: string;
  anchor: string;
}>;

export function exact(value: string | null | undefined): ExactDecimal {
  return new ExactDecimal(value ?? '0');
}

export function sumExact(values: readonly (string | null | undefined)[]): string {
  return values.reduce((total, value) => total.add(exact(value)), new ExactDecimal('0')).toString();
}

export function addExact(left: string, right: string): string {
  return exact(left).add(exact(right)).toString();
}

export function subtractExact(left: string, right: string): string {
  return exact(left).subtract(exact(right)).toString();
}

export function formatMoney(value: string | null | undefined): string {
  return exact(value).quantize(DECIMAL_POLICIES.money).value.toFixed(DECIMAL_POLICIES.money.scale);
}

export function formatLitres(value: string | null | undefined): string {
  return exact(value)
    .quantize(DECIMAL_POLICIES.litres)
    .value.toFixed(DECIMAL_POLICIES.litres.scale);
}

export function formatUnitPrice(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return exact(value)
    .quantize(DECIMAL_POLICIES.unitPrice)
    .value.toFixed(DECIMAL_POLICIES.unitPrice.scale);
}

export function averageRealizedPrice(litres: string, value: string): string | null {
  const quantity = exact(litres);
  if (quantity.value.isZero()) return null;
  return new ExactDecimal(exact(value).value.div(quantity.value).toFixed())
    .quantize(DECIMAL_POLICIES.unitPrice)
    .value.toFixed(DECIMAL_POLICIES.unitPrice.scale);
}

export function ratioPercentage(numerator: string, denominator: string): string | null {
  const base = exact(denominator);
  if (base.value.isZero()) return null;
  return new ExactDecimal(exact(numerator).value.div(base.value).mul(100).toFixed())
    .quantize(DECIMAL_POLICIES.ratio)
    .toString();
}

export function uniqueIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function customerScopeAvailability(
  stationId?: string,
): 'AVAILABLE' | 'UNAVAILABLE_STATION_DIMENSION' {
  return stationId ? 'UNAVAILABLE_STATION_DIMENSION' : 'AVAILABLE';
}

export function deriveCashPosition(input: {
  evidence: string;
  collected: string;
  banked: string;
  variance: string;
}) {
  return {
    cashEvidence: formatMoney(input.evidence),
    collected: formatMoney(input.collected),
    awaitingCollection: formatMoney(subtractExact(input.evidence, input.collected)),
    banked: formatMoney(input.banked),
    collectedButNotBanked: formatMoney(subtractExact(input.collected, input.banked)),
    cashVariance: formatMoney(input.variance),
  };
}

export function groupByKey<T extends Record<string, unknown>>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row)) ?? [];
    group.push(row);
    groups.set(key(row), group);
  }
  return groups;
}

function hasValue(value: string): boolean {
  return !exact(value).value.isZero();
}

/**
 * Build a read-only, report-backed needs-attention projection.
 *
 * This deliberately uses non-zero facts rather than invented thresholds. It
 * does not acknowledge, resolve, or mutate the source domains; each item
 * points back to the evidence section already rendered by the report.
 */
export function buildReportingNeedsAttention(
  report: Pick<
    ManagementReport,
    'currency' | 'cash' | 'providers' | 'inventory' | 'revenue' | 'costing' | 'grossMargin'
  >,
): readonly ReportingAttentionItem[] {
  const items: ReportingAttentionItem[] = [];
  const money = (value: string) => `${formatMoney(value)} ${report.currency}`;

  if (hasValue(report.cash.cashVariance)) {
    items.push({
      id: 'cash-variance',
      priority: 'warning',
      title: 'Cash variance needs explanation',
      detail: `The selected period has a cash variance of ${money(report.cash.cashVariance)}.`,
      meta: 'A5 cash declaration evidence',
      anchor: '#cash-report-title',
    });
  }
  if (hasValue(report.cash.awaitingCollection)) {
    items.push({
      id: 'cash-awaiting-collection',
      priority: 'warning',
      title: 'Cash evidence is awaiting collection',
      detail: `${money(report.cash.awaitingCollection)} remains between cash evidence and A6 collection.`,
      meta: 'Cash custody · collection workflow',
      anchor: '#cash-report-title',
    });
  }
  if (hasValue(report.cash.collectedButNotBanked)) {
    items.push({
      id: 'cash-awaiting-banking',
      priority: 'warning',
      title: 'Collected cash is not yet banked',
      detail: `${money(report.cash.collectedButNotBanked)} is collected but not confirmed banked.`,
      meta: 'A6 collection and bank confirmation evidence',
      anchor: '#cash-report-title',
    });
  }
  if (hasValue(report.providers.unmatchedEvidenceAmount)) {
    items.push({
      id: 'provider-unmatched-evidence',
      priority: 'warning',
      title: 'Provider payment evidence is unmatched',
      detail: `${money(report.providers.unmatchedEvidenceAmount)} of POS/ECOCASH evidence has no settlement allocation.`,
      meta: 'A5 provider evidence · A9 settlement matching',
      anchor: '#provider-report-title',
    });
  }
  if (hasValue(report.providers.unallocatedProviderAmount)) {
    items.push({
      id: 'provider-unallocated-settlement',
      priority: 'warning',
      title: 'Provider settlement remains unallocated',
      detail: `${money(report.providers.unallocatedProviderAmount)} of settlement gross remains outstanding.`,
      meta: 'A9 settlement allocation evidence',
      anchor: '#provider-report-title',
    });
  }
  if (hasValue(report.providers.settlementVariance)) {
    items.push({
      id: 'provider-settlement-variance',
      priority: 'warning',
      title: 'Provider settlement variance needs review',
      detail: `Settlement variance totals ${money(report.providers.settlementVariance)} for the selected period.`,
      meta: 'A9 settlement evidence',
      anchor: '#provider-report-title',
    });
  }
  if (hasValue(report.inventory.varianceLitres)) {
    items.push({
      id: 'inventory-variance',
      priority: 'warning',
      title: 'Inventory variance needs review',
      detail: `Physical stock differs from expected stock by ${formatLitres(report.inventory.varianceLitres)} L.`,
      meta: 'A4 movement and tank-dip evidence',
      anchor: '#inventory-report-title',
    });
  }
  if (report.revenue.saleCount > 0 && report.grossMargin === null) {
    items.push({
      id: 'gross-margin-unavailable',
      priority: 'info',
      title: 'Gross margin is unavailable for some sales',
      detail: `COGS status is ${report.costing.costingStatus}; the report will not estimate gross margin.`,
      meta: 'A12 costing and REV1 revenue lineage',
      anchor: '#report-explanation-title',
    });
  }

  return items;
}
