import { AppError } from '../../platform/errors';
import type {
  AvailableContext,
  ContextLegalEntity,
  ContextOrganisation,
  ContextSelection,
  ContextStation,
} from './contracts';
import type { ContextRoutePolicy } from './routes';

export function findOrganisation(
  available: AvailableContext,
  organisationId: string,
): ContextOrganisation | undefined {
  return available.organisations.find((organisation) => organisation.id === organisationId);
}

export function findLegalEntity(
  organisation: ContextOrganisation,
  legalEntityId: string,
): ContextLegalEntity | undefined {
  return organisation.legalEntities.find((legalEntity) => legalEntity.id === legalEntityId);
}

export function findStation(
  organisation: ContextOrganisation,
  stationId: string,
): { legalEntity: ContextLegalEntity; station: ContextStation } | undefined {
  for (const legalEntity of organisation.legalEntities) {
    const station = legalEntity.stations.find((candidate) => candidate.id === stationId);
    if (station) return { legalEntity, station };
  }
  return undefined;
}

/**
 * Validate and normalize an untrusted selection against a fresh authorized
 * discovery result. The returned value is safe to persist or use for routing.
 */
export function validateContextSelection(
  available: AvailableContext,
  selection: ContextSelection,
  policy: ContextRoutePolicy,
): ContextSelection {
  const organisation = findOrganisation(available, selection.organisationId);
  if (!organisation) throw invalidContext('organisation');

  let legalEntity = selection.legalEntityId
    ? findLegalEntity(organisation, selection.legalEntityId)
    : undefined;
  if (selection.legalEntityId && !legalEntity) throw invalidContext('legal entity');

  const stationMatch = selection.stationId
    ? findStation(organisation, selection.stationId)
    : undefined;
  if (selection.stationId && !stationMatch) throw invalidContext('station');

  if (stationMatch) {
    if (legalEntity && legalEntity.id !== stationMatch.legalEntity.id) {
      throw invalidContext('station and legal entity');
    }
    legalEntity = stationMatch.legalEntity;
  }

  if (policy.legalEntity === 'required' && !legalEntity) {
    throw invalidContext('legal entity');
  }
  if (selection.allStations && selection.stationId) {
    throw invalidContext('all-stations selection');
  }
  if (selection.allStations && !policy.allStationsAllowed) {
    throw invalidContext('all-stations selection');
  }
  if (policy.station === 'required' && !selection.stationId) {
    throw invalidContext('station');
  }
  if (selection.stationId && policy.station !== 'required' && selection.allStations) {
    throw invalidContext('station selection');
  }

  return {
    organisationId: organisation.id,
    ...(legalEntity ? { legalEntityId: legalEntity.id } : {}),
    ...(selection.stationId ? { stationId: selection.stationId } : {}),
    allStations: selection.allStations,
  };
}

export function defaultContextSelection(
  available: AvailableContext,
  policy: ContextRoutePolicy,
): ContextSelection | null {
  const organisation = available.organisations[0];
  if (!organisation) return null;
  const legalEntity = organisation.legalEntities[0];
  if (policy.legalEntity === 'required' && !legalEntity) return null;

  // A station-level person has no permissions across all stations, so starting there
  // would leave their navigation and page empty. Start on their own station instead.
  if (policy.allStationsAllowed && !legalEntity?.stationsOnly) {
    return {
      organisationId: organisation.id,
      ...(policy.legalEntity === 'required' && legalEntity
        ? { legalEntityId: legalEntity.id }
        : {}),
      allStations: true,
    };
  }

  const station = legalEntity?.stations[0];
  if (policy.station === 'required' && !station) return null;
  return {
    organisationId: organisation.id,
    ...(legalEntity ? { legalEntityId: legalEntity.id } : {}),
    ...(station ? { stationId: station.id } : {}),
    allStations: false,
  };
}

export function invalidContext(subject: string): AppError {
  return new AppError('FORBIDDEN', `The requested ${subject} is not authorised in this context`);
}
