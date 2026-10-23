import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { PageContainer } from '@/design-system/layout';
import { getServerShellAccess } from '@/design-system/navigation-server';
import { EmptyState } from '@/design-system/primitives';
import { AlertEmailPanel } from '@/modules/alerts/ui/alert-email-panel';

export const metadata = { title: 'Email alerts' };
export const dynamic = 'force-dynamic';

/**
 * Where a person switches alert emails off (every email links here) and where the owner or an
 * administrator turns them on for the organisation. A page of its own, because the Settings
 * screen is locked (DEC-046).
 */
export default async function AlertEmailPage() {
  const access = await getServerShellAccess(await headers());
  if (access.status === 'signed-out') redirect('/login');
  const current = access.status === 'ready' ? access.current : null;
  const stationId = current && !current.allStations ? current.stationId : undefined;

  return (
    <AppShell shellAccess={access} pageSubtitle="Choose who gets the daily alert email.">
      <PageContainer width="narrow">
        {!current ? (
          <EmptyState
            title="Choose a station"
            message="Use the selector at the top of the page to pick your station."
          />
        ) : (
          <AlertEmailPanel tenantId={current.organisationId} stationId={stationId} />
        )}
      </PageContainer>
    </AppShell>
  );
}
