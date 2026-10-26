import type { ContextRoutePolicy } from './routes';

export type ContextStation = Readonly<{
  id: string;
  code: string;
  name: string;
  timezone: string;
  /** ONBOARDING while the station is still being set up; absent means live. */
  status?: 'ACTIVE' | 'ONBOARDING';
}>;

export type ContextLegalEntity = Readonly<{
  id: string;
  name: string;
  stations: readonly ContextStation[];
}>;

export type ContextOrganisation = Readonly<{
  id: string;
  name: string;
  legalEntities: readonly ContextLegalEntity[];
}>;

/** The only context tree that may be sent to a browser. It is already authorised. */
export type AvailableContext = Readonly<{
  organisations: readonly ContextOrganisation[];
}>;

/**
 * A selected scope. `allStations` is intentionally independent from a missing
 * station id: consumers must opt into the cross-station meaning explicitly.
 */
export type ContextSelection = Readonly<{
  organisationId: string;
  legalEntityId?: string;
  stationId?: string;
  allStations: boolean;
}>;

export type CurrentContext = ContextSelection;

export type ContextResolution = Readonly<{
  available: AvailableContext;
  current: CurrentContext | null;
  route: Readonly<{
    pathname: string;
    policy: ContextRoutePolicy;
  }>;
  persistedContextInvalid: boolean;
}>;

export type ContextApiResponse = Readonly<{
  data: ContextResolution;
}>;
