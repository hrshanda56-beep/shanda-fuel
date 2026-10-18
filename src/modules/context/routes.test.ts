import { describe, expect, it } from 'vitest';

import {
  buildContextHref,
  contextRoutePolicy,
  isCurrentSelection,
  readContextRoute,
} from './routes';

const selection = {
  organisationId: '11111111-1111-4111-8111-111111111111',
  legalEntityId: '22222222-2222-4222-8222-222222222222',
  stationId: '33333333-3333-4333-8333-333333333333',
  allStations: false,
} as const;

describe('context route policy', () => {
  it('supports both overall and individual station dashboard views', () => {
    expect(contextRoutePolicy('/').allStationsAllowed).toBe(true);
    expect(
      buildContextHref('/', '?stationId=old', {
        organisationId: selection.organisationId,
        allStations: true,
      }),
    ).toBe(`/?tenantId=${selection.organisationId}&allStations=true`);
    expect(buildContextHref('/', '', selection)).toContain(`stationId=${selection.stationId}`);
  });
  it('marks station command routes as station-required', () => {
    expect(contextRoutePolicy('/stations/station-a/cash')).toEqual({
      legalEntity: 'required',
      station: 'required',
      allStationsAllowed: false,
    });
    expect(contextRoutePolicy('/reports')).toEqual({
      legalEntity: 'optional',
      station: 'optional',
      allStationsAllowed: true,
    });
  });

  it('requires one station for My Shift and never means all stations', () => {
    expect(contextRoutePolicy('/my-shift')).toEqual({
      legalEntity: 'required',
      station: 'required',
      allStationsAllowed: false,
    });
  });

  it('replaces a dynamic station route without leaving a stale station query', () => {
    expect(
      buildContextHref('/stations/old-station/cash', '?tenantId=old&stationId=old', selection),
    ).toBe(
      `/stations/${selection.stationId}/cash?tenantId=${selection.organisationId}&legalEntityId=${selection.legalEntityId}`,
    );
  });

  it('makes all-stations explicit on cross-station routes', () => {
    expect(
      buildContextHref('/reports', '', {
        organisationId: selection.organisationId,
        allStations: true,
      }),
    ).toBe(`/reports?tenantId=${selection.organisationId}&allStations=true`);
    expect(buildContextHref('/reports', '', selection)).toBe(
      `/reports?tenantId=${selection.organisationId}&legalEntityId=${selection.legalEntityId}&stationId=${selection.stationId}`,
    );
  });

  it('prefers a station encoded in the path over a query station', () => {
    expect(
      readContextRoute(
        '/stations/path-station/cash',
        new URLSearchParams('stationId=query-station'),
      ),
    ).toMatchObject({ stationId: 'path-station', hasExplicitStation: true });
  });
});

describe('isCurrentSelection', () => {
  const current = { ...selection };

  it('treats the station you are already on as current, so the picker closes instead of posting', () => {
    expect(isCurrentSelection(current, selection)).toBe(true);
    expect(isCurrentSelection(current, { ...selection, legalEntityId: undefined })).toBe(true);
  });
  it('treats a different station, entity or organisation as a real switch', () => {
    expect(isCurrentSelection(current, { ...selection, stationId: 'other' })).toBe(false);
    expect(isCurrentSelection(current, { ...selection, legalEntityId: 'other' })).toBe(false);
    expect(isCurrentSelection(current, { ...selection, organisationId: 'other' })).toBe(false);
  });
  it('distinguishes all stations from a single station', () => {
    const all = { organisationId: selection.organisationId, allStations: true } as const;
    expect(isCurrentSelection(current, all)).toBe(false);
    expect(isCurrentSelection({ ...current, stationId: undefined, allStations: true }, all)).toBe(
      true,
    );
  });
  it('is never current before the context has resolved', () => {
    expect(isCurrentSelection(null, selection)).toBe(false);
    expect(isCurrentSelection(undefined, selection)).toBe(false);
  });
});
