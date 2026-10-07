import { AppError } from '../../platform/errors';
import type {
  AvailableContext,
  ContextLegalEntity,
  ContextOrganisation,
  ContextSelection,
  ContextStation,
} from './contracts';
import type { ContextRoutePolicy } from './routes';

export type ContextOption = Readonly<{
  selection: ContextSelection;
  organisationName: string;
  legalEntityName?: string;
  stationName?: string;
  stationCode?: string;
}>;

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

/**
 * Present the authorised work contexts that are valid for a route. This is a
 * display/selection projection only; the server still validates the chosen
 * selection before persisting or using it.
 */
export function listContextOptions(
  available: AvailableContext,
  policy: ContextRoutePolicy,
): readonly ContextOption[] {
  const options: ContextOption[] = [];

  for (const organisation of available.organisations) {
    if (policy.allStationsAllowed) {
      if (policy.legalEntity === 'required') {
        for (const legalEntity of organisation.legalEntities) {
          options.push({
            selection: {
              organisationId: organisation.id,
              legalEntityId: legalEntity.id,
              allStations: true,
            },
            organisationName: organisation.name,
            legalEntityName: legalEntity.name,
          });
        }
      } else {
        options.push({
          selection: { organisationId: organisation.id, allStations: true },
          organisationName: organisation.name,
        });
      }
      continue;
    }

    for (const legalEntity of organisation.legalEntities) {
      if (legalEntity.stations.length > 0) {
        for (const station of legalEntity.stations) {
          options.push({
            selection: {
              organisationId: organisation.id,
              legalEntityId: legalEntity.id,
              stationId: station.id,
              allStations: false,
            },
            organisationName: organisation.name,
            legalEntityName: legalEntity.name,
            stationName: station.name,
            stationCode: station.code,
          });
        }
      } else if (policy.station !== 'required') {
        options.push({
          selection: {
            organisationId: organisation.id,
            legalEntityId: legalEntity.id,
            allStations: false,
          },
          organisationName: organisation.name,
          legalEntityName: legalEntity.name,
        });
      }
    }
  }

  return options;
}

export function defaultContextSelection(
  available: AvailableContext,
  policy: ContextRoutePolicy,
): ContextSelection | null {
  const options = listContextOptions(available, policy);
  return options.length === 1 ? options[0]!.selection : null;
}

export function invalidContext(subject: string): AppError {
  return new AppError('FORBIDDEN', `The requested ${subject} is not authorised in this context`);
}
