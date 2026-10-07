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
  E2E_NAVIGATION_FIXTURE_HEADER,
} from '@/design-system/navigation-projection';

import { ProductionSafeOverview } from './_overview/overview-dashboard';

export const metadata = {
  title: { absolute: 'Today · Shanda Fuel' },
};

/** Resolve entry access before rendering the application shell or Today data. */
export default async function OverviewPage() {
  const requestHeaders = await headers();

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
