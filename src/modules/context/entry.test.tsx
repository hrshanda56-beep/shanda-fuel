import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EntryLoadingState } from '../../design-system/root-entry';
import type { ContextResolution } from './contracts';
import { classifyRootEntryState, resolveRootEntryState } from './entry';
import { encodeSelection, readPersistedContext } from './persistence';

const resolution = (
  current: ContextResolution['current'],
  organisations = 1,
): ContextResolution => ({
  available: {
    organisations: Array.from({ length: organisations }, (_, index) => ({
      id: `11111111-1111-4111-8111-11111111111${index}`,
      name: `Organisation ${index + 1}`,
      legalEntities: [
        {
          id: `22222222-2222-4222-8222-22222222222${index}`,
          name: `Entity ${index + 1}`,
          stations: [
            {
              id: `33333333-3333-4333-8333-33333333333${index}`,
              code: `ST${index + 1}`,
              name: `Station ${index + 1}`,
              timezone: 'Africa/Harare',
            },
          ],
        },
      ],
    })),
  },
  current,
  route: {
    pathname: '/',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
  },
  persistedContextInvalid: false,
});

describe('root entry state machine', () => {
  it('treats an unauthenticated root visit as unauthenticated', async () => {
    const state = await resolveRootEntryState(new Request('http://shanda-fuel.local/'), {
      resolveActor: async () => null,
    });
    expect(state).toEqual({ status: 'unauthenticated' });
  });

  it('classifies a single resolved context as ready', () => {
    const current = {
      organisationId: '11111111-1111-4111-8111-111111111110',
      legalEntityId: '22222222-2222-4222-8222-222222222220',
      stationId: '33333333-3333-4333-8333-333333333330',
      allStations: false,
    };
    expect(classifyRootEntryState(resolution(current))).toMatchObject({ status: 'ready' });
  });

  it('requires a focused choice when multiple contexts have no selection', () => {
    expect(classifyRootEntryState(resolution(null, 2))).toMatchObject({
      status: 'choose-context',
    });
  });

  it('shows the account access state when no authorised context exists', () => {
    expect(classifyRootEntryState(resolution(null, 0))).toEqual({
      status: 'no-authorised-context',
    });
  });

  it('keeps the loading entry free of shell and dashboard empty states', () => {
    const markup = renderToStaticMarkup(<EntryLoadingState />);
    expect(markup).toContain('Preparing your workspace');
    expect(markup).not.toContain('app-shell');
    expect(markup).not.toContain('Live position is not available');
  });

  it('round-trips the existing server-validated context persistence contract', () => {
    const selection = {
      organisationId: '11111111-1111-4111-8111-111111111111',
      legalEntityId: '22222222-2222-4222-8222-222222222222',
      stationId: '33333333-3333-4333-8333-333333333333',
      allStations: false,
    } as const;
    const request = new Request('http://shanda-fuel.local/', {
      headers: { cookie: `shanda-fuel-context=${encodeSelection(selection)}` },
    });
    expect(readPersistedContext(request)).toEqual({ selection, invalid: false });
  });
});
