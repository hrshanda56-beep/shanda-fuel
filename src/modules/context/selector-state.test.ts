import { expect, it } from 'vitest';
import { contextReadFailure, selectionForDisplay } from './selector-state';
import type { ContextResolution } from './contracts';
const snapshot: ContextResolution = {
  available: {
    organisations: [
      {
        id: 'tenant',
        name: 'Owner',
        legalEntities: [
          {
            id: 'entity',
            name: 'Entity',
            stations: [{ id: 'station', name: 'Arcturus', code: 'A', timezone: 'UTC' }],
          },
        ],
      },
    ],
  },
  current: {
    organisationId: 'tenant',
    legalEntityId: 'entity',
    stationId: 'station',
    allStations: false,
  },
  persistedContextInvalid: false,
  route: {
    pathname: '/',
    policy: { station: 'optional', legalEntity: 'optional', allStationsAllowed: true },
  },
};
it('retains the selected station for same-organisation navigation without rediscovery', () => {
  expect(selectionForDisplay(snapshot, '/settings', '?tenantId=tenant')?.current).toEqual(
    snapshot.current,
  );
});
it('displays explicit All stations without retaining the previous station', () => {
  expect(
    selectionForDisplay(snapshot, '/settings', '?tenantId=tenant&allStations=true')?.current,
  ).toEqual({ organisationId: 'tenant', allStations: true });
});
it('does not display another tenant or an unauthorized station from a previous snapshot', () => {
  expect(selectionForDisplay(snapshot, '/reports', '?tenantId=foreign')).toBeUndefined();
  expect(
    selectionForDisplay(snapshot, '/reports', '?tenantId=tenant&stationId=foreign'),
  ).toBeUndefined();
  expect(selectionForDisplay(undefined, '/', '')).toBeUndefined();
});
it('distinguishes session expiry, access changes and retryable connection failures', () => {
  expect(contextReadFailure(401).kind).toBe('session');
  expect(contextReadFailure(403).kind).toBe('access');
  expect(contextReadFailure(503).kind).toBe('connection');
  expect(contextReadFailure().message).toContain('selection has been kept');
});
