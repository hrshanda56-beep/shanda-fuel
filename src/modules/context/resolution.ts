import type { AvailableContext, ContextResolution, ContextSelection } from './contracts';
import { defaultContextSelection, invalidContext, validateContextSelection } from './domain';
import type { ContextRoute, ContextRoutePolicy } from './routes';

function routeSelection(available: AvailableContext, route: ContextRoute): ContextSelection | null {
  if (
    !route.hasExplicitOrganisation &&
    !route.hasExplicitLegalEntity &&
    !route.hasExplicitStation &&
    !route.hasExplicitAllStations
  ) {
    return null;
  }

  if (route.organisationId) {
    return {
      organisationId: route.organisationId,
      ...(route.legalEntityId ? { legalEntityId: route.legalEntityId } : {}),
      ...(route.stationId ? { stationId: route.stationId } : {}),
      allStations: route.allStations,
    };
  }

  const matches = available.organisations.flatMap((organisation) =>
    organisation.legalEntities.flatMap((legalEntity) => {
      const legalMatches = route.legalEntityId ? legalEntity.id === route.legalEntityId : true;
      const stationMatches = route.stationId
        ? legalEntity.stations.some((station) => station.id === route.stationId)
        : true;
      return legalMatches && stationMatches ? [{ organisation, legalEntity }] : [];
    }),
  );
  if (matches.length !== 1) throw invalidContext('route context');
  const match = matches[0]!;
  return {
    organisationId: match.organisation.id,
    ...(route.legalEntityId || route.stationId ? { legalEntityId: match.legalEntity.id } : {}),
    ...(route.stationId ? { stationId: route.stationId } : {}),
    allStations: route.allStations,
  };
}

function validatePersistedSelection(
  available: AvailableContext,
  persisted: ContextSelection,
  policy: ContextRoutePolicy,
): ContextSelection | null {
  try {
    return validateContextSelection(available, persisted, policy);
  } catch {
    return null;
  }
}

export function resolveAvailableContext(
  available: AvailableContext,
  route: ContextRoute,
  policy: ContextRoutePolicy,
  persisted: { selection?: ContextSelection | null; invalid: boolean },
): ContextResolution {
  const explicit = routeSelection(available, route);
  let current: ContextSelection | null = null;
  let persistedSelectionInvalid = false;
  if (explicit) {
    current = validateContextSelection(available, explicit, policy);
  } else if (persisted.selection) {
    current = validatePersistedSelection(available, persisted.selection, policy);
    persistedSelectionInvalid = current === null;
  }
  current ??= defaultContextSelection(available, policy);

  return {
    available,
    current,
    route: { pathname: route.pathname, policy },
    persistedContextInvalid: persisted.invalid || persistedSelectionInvalid,
  };
}
