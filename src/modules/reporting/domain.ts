import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';

/**
 * The calendar date "today" is for a company that runs stations in these time zones: the latest
 * local date among them, so nothing delivered locally today is left out. A time zone that is not
 * recognised is ignored; with none left the date is the server's UTC date.
 */
export function latestStationLocalDate(now: Date, timeZones: readonly string[]): string {
  const dates: string[] = [];
  for (const timeZone of timeZones) {
    try {
      dates.push(new Intl.DateTimeFormat('en-CA', { timeZone }).format(now));
    } catch {
      // Not a real time zone name; skip it.
    }
  }
  return dates.length > 0 ? dates.sort().at(-1)! : now.toISOString().slice(0, 10);
}

export function exact(value: string | null | undefined): ExactDecimal {
  return new ExactDecimal(value ?? '0');
}

export function sumExact(values: readonly (string | null | undefined)[]): string {
  return values.reduce((total, value) => total.add(exact(value)), new ExactDecimal('0')).toString();
}

/**
 * Aggregates an observed measure only when every supplied value is present.
 * An empty set is a genuine zero; a null inside a non-empty set means the
 * aggregate is unavailable rather than zero.
 */
export function sumObservedExact(values: readonly (string | null | undefined)[]): string | null {
  if (values.length > 0 && values.some((value) => value === null || value === undefined)) {
    return null;
  }
  return sumExact(values);
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

/**
 * Merges the legacy single `stationId` and the multi-station `stationIds`
 * into one sorted, de-duplicated list. An empty list means every station.
 */
export function normalizeStationIds(
  stationId: string | undefined,
  stationIds: readonly string[] | undefined,
): string[] {
  return [...new Set([...(stationId ? [stationId] : []), ...(stationIds ?? [])])].sort();
}

export function customerScopeAvailability(
  stationIds: readonly string[] = [],
): 'AVAILABLE' | 'UNAVAILABLE_STATION_DIMENSION' {
  return stationIds.length > 0 ? 'UNAVAILABLE_STATION_DIMENSION' : 'AVAILABLE';
}

export function deriveCashPosition(input: {
  evidence: string;
  /** Cash paid out of the till for expenses; it never reaches the people collecting. */
  paidExpenses?: string;
  collected: string;
  deposited?: string;
  banked: string;
  variance: string;
  atStation?: string;
  heldByManagement?: string;
  inTransit?: string;
}) {
  const deposited = input.deposited ?? input.banked;
  return {
    cashEvidence: formatMoney(input.evidence),
    cashPaidExpenses: formatMoney(input.paidExpenses ?? '0'),
    collected: formatMoney(input.collected),
    awaitingCollection: formatMoney(
      subtractExact(subtractExact(input.evidence, input.paidExpenses ?? '0'), input.collected),
    ),
    deposited: formatMoney(deposited),
    banked: formatMoney(input.banked),
    // This is deliberately based on deposits, not confirmations: cash in an
    // unconfirmed deposit is in transit, not still at the station.
    collectedButNotBanked: formatMoney(subtractExact(input.collected, deposited)),
    ...(input.atStation !== undefined ? { atStation: formatMoney(input.atStation) } : {}),
    ...(input.heldByManagement !== undefined
      ? { heldByManagement: formatMoney(input.heldByManagement) }
      : {}),
    ...(input.inTransit !== undefined ? { inTransit: formatMoney(input.inTransit) } : {}),
    cashVariance: formatMoney(input.variance),
  };
}

/**
 * Where all collected cash is, in exactly one of five places (B4). The caller supplies the amounts
 * per place and the total collected; this formats them and refuses to return a split that does not
 * add up, so no screen can show custody figures that disagree with what was received.
 */
export function deriveCashCustody(input: {
  atStation: string;
  withCollector: string;
  heldByManagement: string;
  awaitingBank: string;
  banked: string;
  total: string;
}) {
  const places = sumExact([
    input.atStation,
    input.withCollector,
    input.heldByManagement,
    input.awaitingBank,
    input.banked,
  ]);
  if (!exact(places).value.eq(exact(input.total).value)) {
    throw new Error(
      `Cash custody does not add up: the five places total ${places} but ${input.total} was collected`,
    );
  }
  return {
    atStation: formatMoney(input.atStation),
    withCollector: formatMoney(input.withCollector),
    heldByManagement: formatMoney(input.heldByManagement),
    awaitingBank: formatMoney(input.awaitingBank),
    banked: formatMoney(input.banked),
    total: formatMoney(input.total),
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
