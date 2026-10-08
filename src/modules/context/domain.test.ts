import { describe, expect, it } from 'vitest';

import { defaultContextSelection, findStation, validateContextSelection } from './domain';
import type { AvailableContext } from './contracts';
import { contextRoutePolicy } from './routes';

const ids = {
  organisation: '11111111-1111-4111-8111-111111111111',
  legalEntityA: '22222222-2222-4222-8222-222222222222',
  legalEntityB: '33333333-3333-4333-8333-333333333333',
  stationA: '44444444-4444-4444-8444-444444444444',
  stationB: '55555555-5555-4555-8555-555555555555',
};

const available: AvailableContext = {
  organisations: [
    {
      id: ids.organisation,
      name: 'Authorised organisation',
      legalEntities: [
        {
          id: ids.legalEntityA,
          name: 'Trading entity A',
          stations: [
            { id: ids.stationA, code: 'STA', name: 'Station A', timezone: 'Africa/Harare' },
          ],
        },
        {
          id: ids.legalEntityB,
          name: 'Trading entity B',
          stations: [
            { id: ids.stationB, code: 'STB', name: 'Station B', timezone: 'Africa/Harare' },
          ],
        },
      ],
    },
  ],
};

describe('context selection contract', () => {
  it('normalizes a station to its authorised legal entity', () => {
    expect(
      validateContextSelection(
        available,
        { organisationId: ids.organisation, stationId: ids.stationA, allStations: false },
        contextRoutePolicy('/stations/station-a/cash'),
      ),
    ).toEqual({
      organisationId: ids.organisation,
      legalEntityId: ids.legalEntityA,
      stationId: ids.stationA,
      allStations: false,
    });
  });

  it('rejects arbitrary, cross-legal-entity, and all-stations station-required selections', () => {
    const policy = contextRoutePolicy('/stations/station-a/cash');
    expect(() =>
      validateContextSelection(
        available,
        {
          organisationId: ids.organisation,
          stationId: '66666666-6666-4666-8666-666666666666',
          allStations: false,
        },
        policy,
      ),
    ).toThrow('station');
    expect(() =>
      validateContextSelection(
        available,
        {
          organisationId: ids.organisation,
          legalEntityId: ids.legalEntityA,
          stationId: ids.stationB,
          allStations: false,
        },
        policy,
      ),
    ).toThrow('station and legal entity');
    expect(() =>
      validateContextSelection(
        available,
        { organisationId: ids.organisation, legalEntityId: ids.legalEntityA, allStations: true },
        policy,
      ),
    ).toThrow('station');
  });

  it('keeps all-stations explicit and route-scoped', () => {
    const policy = contextRoutePolicy('/reports');
    expect(
      validateContextSelection(
        available,
        { organisationId: ids.organisation, allStations: true },
        policy,
      ),
    ).toEqual({ organisationId: ids.organisation, allStations: true });
    expect(defaultContextSelection(available, policy)).toEqual({
      organisationId: ids.organisation,
      allStations: true,
    });
    expect(findStation(available.organisations[0]!, ids.stationB)?.legalEntity.id).toBe(
      ids.legalEntityB,
    );
  });
});
