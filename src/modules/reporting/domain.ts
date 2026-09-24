import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';

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
