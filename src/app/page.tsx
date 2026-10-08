import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import {
  EntryUnavailableState,
  NoAuthorisedContextState,
  RootContextChooser,
} from '@/design-system/root-entry';
import { resolveRootEntryState } from '@/modules/context/server';
import {
  allowsE2ENavigationFixture,
  E2E_ENTRY_FIXTURE_HEADER,
  E2E_NAVIGATION_FIXTURE_HEADER,
  resolveE2EEntryFixture,
} from '@/design-system/navigation-projection';
import type { ContextResolution } from '@/modules/context';

import { ProductionSafeOverview } from './_overview/overview-dashboard';

export const metadata = {
  title: { absolute: 'Today · Shanda Fuel' },
};

/** Resolve entry access before rendering the application shell or Today data. */
export default async function OverviewPage() {
  const requestHeaders = await headers();

  const entryFixture = resolveE2EEntryFixture(
    process.env.APP_ENV,
    requestHeaders.get(E2E_ENTRY_FIXTURE_HEADER),
    process.env.NODE_ENV,
  );
  if (entryFixture === 'unavailable') return <EntryUnavailableState />;
  if (entryFixture === 'no-authorised-context') return <NoAuthorisedContextState />;
  if (entryFixture === 'choose-context') {
    return <RootContextChooser resolution={entryFixtureResolution} />;
  }

  // Presentation-only E2E fixture. Production always takes the authenticated
  // server entry gate below; this keeps shell tests independent of PostgreSQL.
  if (
    allowsE2ENavigationFixture(
      process.env.APP_ENV,
      requestHeaders.get(E2E_NAVIGATION_FIXTURE_HEADER),
      process.env.NODE_ENV,
    )
  ) {
    return (
      <AppShell
        searchPlacement="header"
        pageSubtitle="Live figures appear as operational evidence is recorded."
      >
        <ProductionSafeOverview />
      </AppShell>
    );
  }

  const request = new Request('http://shanda-fuel.local/', { headers: requestHeaders });
  const entry = await resolveRootEntryState(request);

  if (entry.status === 'unauthenticated') redirect('/login');
  if (entry.status === 'no-authorised-context') return <NoAuthorisedContextState />;
  if (entry.status === 'choose-context') {
    return <RootContextChooser resolution={entry.resolution} />;
  }
  if (entry.status === 'unavailable') return <EntryUnavailableState />;

  return (
    <AppShell
      searchPlacement="header"
      pageSubtitle="Live figures appear as operational evidence is recorded."
    >
      <ProductionSafeOverview />
    </AppShell>
  );
}

const entryFixtureResolution: ContextResolution = {
  available: {
    organisations: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Shanda Fuel Group',
        legalEntities: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Shanda Fuel Zimbabwe',
            stations: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                code: 'SF-01',
                name: 'Borrowdale Station',
                timezone: 'Africa/Harare',
              },
            ],
          },
        ],
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Shanda Fuel South',
        legalEntities: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            name: 'Shanda Fuel South Zimbabwe',
            stations: [
              {
                id: '66666666-6666-4666-8666-666666666666',
                code: 'SF-02',
                name: 'Msasa Station',
                timezone: 'Africa/Harare',
              },
            ],
          },
        ],
      },
    ],
  },
  current: null,
  route: {
    pathname: '/',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
  },
  persistedContextInvalid: false,
};
