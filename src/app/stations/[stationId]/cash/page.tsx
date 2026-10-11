import { Suspense } from 'react';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { CashWorkspace } from '@/modules/cash/ui/cash-workspace';

export const metadata = { title: 'Station collections' };

export default async function CashPage({ params }: { params: Promise<{ stationId: string }> }) {
  await params;
  return (
    <AppShell pageSubtitle="Track custody, collection allocation, and distinct bank confirmation.">
      <Suspense
        fallback={
          <ContextRequiredState
            title="Checking station context"
            message="Use the station selector above to choose a station."
          />
        }
      >
        <CashWorkspace />
      </Suspense>
    </AppShell>
  );
}
