import type { ContextSelection, CurrentContext } from './contracts';

export type ContextRoutePolicy = Readonly<{
  legalEntity: 'required' | 'optional';
  station: 'required' | 'optional';
  allStationsAllowed: boolean;
}>;

export type ContextRoute = Readonly<{
  pathname: string;
  organisationId?: string;
  legalEntityId?: string;
  stationId?: string;
  allStations: boolean;
  hasExplicitOrganisation: boolean;
  hasExplicitLegalEntity: boolean;
  hasExplicitStation: boolean;
  hasExplicitAllStations: boolean;
}>;

const DEFAULT_POLICY: ContextRoutePolicy = {
  legalEntity: 'optional',
  station: 'optional',
  allStationsAllowed: false,
};

const REPORTING_POLICY: ContextRoutePolicy = {
  legalEntity: 'optional',
  station: 'optional',
  allStationsAllowed: true,
};

const LEGAL_ENTITY_ALL_STATIONS_POLICY: ContextRoutePolicy = {
  legalEntity: 'required',
  station: 'optional',
  allStationsAllowed: true,
};

const STATION_REQUIRED_POLICY: ContextRoutePolicy = {
  legalEntity: 'required',
  station: 'required',
  allStationsAllowed: false,
};

/**
 * Shared route semantics. Feature code should ask this helper instead of
 * deciding independently whether a missing station means "all stations".
 */
export function contextRoutePolicy(pathname: string | null | undefined): ContextRoutePolicy {
  const path = pathname || '/';
  if (path === '/') return REPORTING_POLICY;
  if (/^\/reports(?:\/|$)/.test(path)) return REPORTING_POLICY;
  if (/^\/suppliers(?:\/|$)/.test(path)) return LEGAL_ENTITY_ALL_STATIONS_POLICY;
  if (
    /^\/stations\/[^/]+(?:\/|$)/.test(path) ||
    /^\/my-shift(?:\/|$)/.test(path) ||
    /^\/finance(?:\/|$)/.test(path) ||
    /^\/operations\/daily(?:\/|$)/.test(path) ||
    /^\/operations\/reconciliations(?:\/|$)/.test(path) ||
    /^\/inventory(?:\/|$)/.test(path)
  ) {
    return STATION_REQUIRED_POLICY;
  }
  return DEFAULT_POLICY;
}

/** Read route context only; this never grants access. */
export function readContextRoute(
  pathname: string | null | undefined,
  searchParams: Pick<URLSearchParams, 'get'> | null,
): ContextRoute {
  const path = pathname || '/';
  const stationInPath = path.match(/^\/stations\/([^/]+)/)?.[1];
  const organisationId =
    searchParams?.get('organisationId') ?? searchParams?.get('tenantId') ?? undefined;
  const legalEntityId = searchParams?.get('legalEntityId') ?? undefined;
  const stationId = stationInPath
    ? safeDecode(stationInPath)
    : (searchParams?.get('stationId') ?? undefined);
  const allStationsValue = searchParams?.get('allStations');
  const allStations = allStationsValue === '1' || allStationsValue === 'true';

  return {
    pathname: path,
    ...(organisationId ? { organisationId } : {}),
    ...(legalEntityId ? { legalEntityId } : {}),
    ...(stationId ? { stationId } : {}),
    allStations,
    hasExplicitOrganisation: Boolean(organisationId),
    hasExplicitLegalEntity: Boolean(legalEntityId),
    hasExplicitStation: Boolean(stationId),
    hasExplicitAllStations: allStationsValue !== null && allStationsValue !== undefined,
  };
}

/**
 * True when a picked selection is where the user already is. The selector closes instead of
 * posting in that case, so tapping the current station can never look like a dead button.
 */
export function isCurrentSelection(
  current: CurrentContext | null | undefined,
  selection: ContextSelection,
): boolean {
  if (!current) return false;
  return (
    current.organisationId === selection.organisationId &&
    current.allStations === selection.allStations &&
    (current.stationId ?? null) === (selection.stationId ?? null) &&
    (selection.legalEntityId === undefined || current.legalEntityId === selection.legalEntityId)
  );
}

/**
 * Build the next URL after a validated server-side selection. A station path
 * is replaced in place; query-only routes retain their path and receive only
 * the context dimensions that their policy permits.
 */
export function buildContextHref(
  pathname: string | null | undefined,
  search: string | URLSearchParams | null | undefined,
  selection: ContextSelection,
): string {
  const path = pathname || '/';
  const policy = contextRoutePolicy(path);
  const params = new URLSearchParams(search ?? '');
  params.set('tenantId', selection.organisationId);
  params.delete('organisationId');

  if (selection.legalEntityId) params.set('legalEntityId', selection.legalEntityId);
  else params.delete('legalEntityId');

  const stationPath = /^\/stations\/([^/]+)/.test(path);
  if (stationPath && selection.stationId) {
    const nextPath = path.replace(
      /^(\/stations\/)([^/]+)/,
      `$1${encodeURIComponent(selection.stationId)}`,
    );
    params.delete('stationId');
    params.delete('allStations');
    return withSearch(nextPath, params);
  }

  if (policy.station === 'required' || (policy.station === 'optional' && !selection.allStations)) {
    if (selection.stationId) params.set('stationId', selection.stationId);
    else params.delete('stationId');
  } else {
    params.delete('stationId');
  }

  if (policy.allStationsAllowed && selection.allStations) params.set('allStations', 'true');
  else params.delete('allStations');

  return withSearch(path, params);
}

function withSearch(path: string, params: URLSearchParams): string {
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
