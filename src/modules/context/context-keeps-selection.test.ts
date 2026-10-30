import { describe, expect, it } from 'vitest';
import {
  navigationSections,
  resolveNavigationItem,
  type WorkContext,
} from '../../design-system/navigation';
import type { AvailableContext, ContextSelection } from './contracts';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ENTITY = '00000000-0000-4000-8000-0000000000b1';
const STATION_1 = '00000000-0000-4000-8000-0000000000c1';
const STATION_2 = '00000000-0000-4000-8000-0000000000c2';

const available: AvailableContext = {
  organisations: [
    {
      id: ORG,
      name: 'Company',
      legalEntities: [
        {
          id: ENTITY,
          name: 'Entity',
          stations: [
            { id: STATION_2, code: 'S2', name: 'Station 2', timezone: 'Africa/Harare' },
            { id: STATION_1, code: 'S1', name: 'Station 1', timezone: 'Africa/Harare' },
          ],
        },
      ],
    },
  ],
};

const items = navigationSections.flatMap((section) => section.items);

function linkFor(selection: ContextSelection, key: string) {
  const item = items.find((candidate) => candidate.key === key)!;
  const context: WorkContext = {
    tenantId: selection.organisationId,
    legalEntityId: selection.legalEntityId,
    ...(selection.allStations ? { allStations: true } : { stationId: selection.stationId }),
  };
  const resolved = resolveNavigationItem(item, context, true);
  return resolved.state === 'link' ? resolved.href : null;
}

function resolveHref(href: string, persisted: ContextSelection | undefined) {
  const url = new URL(href, 'http://localhost');
  return resolveAvailableContext(
    available,
    readContextRoute(url.pathname, url.searchParams),
    contextRoutePolicy(url.pathname),
    { ...(persisted ? { selection: persisted } : {}), invalid: false },
  );
}

const stationSelection = (stationId: string): ContextSelection => ({
  organisationId: ORG,
  legalEntityId: ENTITY,
  stationId,
  allStations: false,
});

describe('the chosen station survives navigation (A1)', () => {
  for (const stationId of [STATION_1, STATION_2]) {
    describe(`station ${stationId.slice(-1)}`, () => {
      for (const item of items) {
        it(`${item.key}: the sidebar link keeps the station`, () => {
          const href = linkFor(stationSelection(stationId), item.key);
          if (href === null) return; // planned area, not a link
          expect(resolveHref(href, stationSelection(stationId)).current?.stationId).toBe(stationId);
        });

        it(`${item.key}: a deep link with no context uses the saved station`, () => {
          const href = linkFor(stationSelection(stationId), item.key);
          if (href === null) return;
          const bare = new URL(href, 'http://localhost').pathname;
          expect(resolveHref(bare, stationSelection(stationId)).current?.stationId).toBe(stationId);
        });
      }
    });
  }

  it('a link that names a different station in its path wins over the saved one', () => {
    const resolved = resolveHref(`/stations/${STATION_1}/cash`, stationSelection(STATION_2));
    expect(resolved.current?.stationId).toBe(STATION_1);
  });

  it('a station chosen only through the address resolves, and the saved copy then keeps it', () => {
    const named = resolveAvailableContext(
      available,
      readContextRoute('/inventory', new URLSearchParams({ tenantId: ORG, stationId: STATION_1 })),
      contextRoutePolicy('/inventory'),
      { invalid: false },
    );
    expect(named.current?.stationId).toBe(STATION_1);
    // With no saved selection a bare link falls back to the first station in the list.
    const unsaved = resolveHref('/inventory/tanks/x', undefined);
    expect(unsaved.current?.stationId).toBe(STATION_2);
    // Once the choice is saved, the same bare link keeps it.
    expect(resolveHref('/inventory/tanks/x', named.current!).current?.stationId).toBe(STATION_1);
  });

  it('all stations works on pages that need a legal entity when the company has only one', () => {
    const all: ContextSelection = { organisationId: ORG, allStations: true };
    const resolved = resolveHref(`/expenses?tenantId=${ORG}&allStations=true`, all);
    expect(resolved.current).toMatchObject({ allStations: true, legalEntityId: ENTITY });
  });

  it('all stations stays all stations on every page that allows it', () => {
    const all: ContextSelection = { organisationId: ORG, allStations: true };
    for (const item of items) {
      const href = linkFor(all, item.key);
      if (href === null) continue;
      const pathname = new URL(href, 'http://localhost').pathname;
      if (!contextRoutePolicy(pathname).allStationsAllowed) continue;
      expect(resolveHref(href, all).current?.allStations, item.key).toBe(true);
    }
  });
});
