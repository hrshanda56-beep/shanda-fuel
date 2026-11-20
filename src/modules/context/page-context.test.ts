import { describe, expect, it } from 'vitest';

import type { AvailableContext, ContextResolution } from './contracts';
import { contextFromShellAccess } from './page-context';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';
import { readPersistedContext } from './persistence';

const ids = {
  organisation: '11111111-1111-4111-8111-111111111111',
  entity: '22222222-2222-4222-8222-222222222222',
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
          id: ids.entity,
          name: 'Trading entity',
          stations: [
            { id: ids.stationA, code: 'STA', name: 'Station A', timezone: 'Africa/Harare' },
            { id: ids.stationB, code: 'STB', name: 'Station B', timezone: 'Africa/Harare' },
          ],
        },
      ],
    },
  ],
};

const request = new Request('https://app.example/my-shift');

function shellResolution(): ContextResolution {
  return resolveAvailableContext(
    available,
    readContextRoute('/', new URLSearchParams()),
    contextRoutePolicy('/'),
    readPersistedContext(request),
  );
}

describe('contextFromShellAccess', () => {
  it('gives the same answer as discovering again, for a station named in the address', () => {
    const params = new URLSearchParams({ stationId: ids.stationB });
    const viaShell = contextFromShellAccess(
      { status: 'ready', resolution: shellResolution() },
      request,
      '/my-shift',
      params,
    );
    const direct = resolveAvailableContext(
      available,
      readContextRoute('/my-shift', params),
      contextRoutePolicy('/my-shift'),
      readPersistedContext(request),
    );
    expect(viaShell).toEqual(direct);
    expect(viaShell?.current?.stationId).toBe(ids.stationB);
  });

  it('only chooses from what the shell found, never from anything else', () => {
    const outsider = '99999999-9999-4999-8999-999999999999';
    let chosen: string | undefined;
    try {
      chosen = contextFromShellAccess(
        { status: 'ready', resolution: shellResolution() },
        request,
        '/my-shift',
        new URLSearchParams({ stationId: outsider }),
      )?.current?.stationId;
    } catch {
      chosen = undefined;
    }
    expect(chosen).not.toBe(outsider);
  });

  it('has nothing to reuse when the shell is not ready', () => {
    expect(
      contextFromShellAccess({ status: 'signed-out' }, request, '/my-shift', new URLSearchParams()),
    ).toBeNull();
    expect(
      contextFromShellAccess(
        { status: 'no-workplace' },
        request,
        '/my-shift',
        new URLSearchParams(),
      ),
    ).toBeNull();
    expect(
      contextFromShellAccess({ status: 'ready' }, request, '/my-shift', new URLSearchParams()),
    ).toBeNull();
  });
});
