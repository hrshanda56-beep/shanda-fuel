/**
 * Report filters as they travel in the page URL: `?stations=a,b&period=3m` or
 * `?period=custom&from=2026-08-01&to=2026-08-31`. An absent `stations` means
 * every station. Pure parsing and serialising; no UI or database code.
 */
import {
  DEFAULT_REPORT_PERIOD,
  isReportPeriod,
  resolvePeriod,
  type ReportPeriod,
  type ResolvedPeriod,
} from './period';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportFilters = Readonly<{
  /** Empty means every station the user may see. */
  stationIds: readonly string[];
  period: ReportPeriod;
  /** Custom range as typed; only meaningful when `period` is `custom`. */
  customFrom: string;
  customTo: string;
}>;

type Params = Pick<URLSearchParams, 'get'>;

export function parseReportFilters(params: Params): ReportFilters {
  const stationIds = [
    ...new Set(
      (params.get('stations') ?? '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter((part) => UUID.test(part)),
    ),
  ].sort();
  const rawPeriod = params.get('period');
  return {
    stationIds,
    period: isReportPeriod(rawPeriod) ? rawPeriod : DEFAULT_REPORT_PERIOD,
    customFrom: params.get('from') ?? '',
    customTo: params.get('to') ?? '',
  };
}

/** Writes the filters onto existing params, leaving unrelated ones (tenantId) alone. */
export function applyReportFilters(base: URLSearchParams, filters: ReportFilters): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of ['stations', 'period', 'from', 'to']) next.delete(key);
  if (filters.stationIds.length > 0) next.set('stations', [...filters.stationIds].sort().join(','));
  if (filters.period !== DEFAULT_REPORT_PERIOD) next.set('period', filters.period);
  if (filters.period === 'custom') {
    if (filters.customFrom) next.set('from', filters.customFrom);
    if (filters.customTo) next.set('to', filters.customTo);
  }
  return next;
}

export function resolveReportFilters(filters: ReportFilters, today: string): ResolvedPeriod | null {
  return resolvePeriod(filters.period, today, {
    fromDate: filters.customFrom,
    toDate: filters.customTo,
  });
}

/** Toggles one station; selecting every station collapses to "all" (empty). */
export function toggleStation(
  selected: readonly string[],
  stationId: string,
  allStationIds: readonly string[],
): string[] {
  const next = selected.includes(stationId)
    ? selected.filter((id) => id !== stationId)
    : [...selected, stationId];
  return next.length >= allStationIds.length ? [] : next.sort();
}

export function describeStations(
  selected: readonly string[],
  stations: readonly { id: string; name: string }[],
): string {
  if (selected.length === 0) {
    // With only one station to choose from, "all" is that station.
    return stations.length === 1 ? stations[0]!.name : 'All stations';
  }
  if (selected.length === 1) {
    return stations.find((station) => station.id === selected[0])?.name ?? '1 station';
  }
  return `${selected.length} stations`;
}
