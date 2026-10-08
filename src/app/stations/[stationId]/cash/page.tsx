import { Suspense } from 'react';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { SkeletonCard, SkeletonTiles } from '@/design-system/page-kit';
import { CashWorkspace } from '@/modules/cash/ui/cash-workspace';

export const metadata = { title: 'Cash and banking' };

export default async function CashPage({ params }: { params: Promise<{ stationId: string }> }) {
  await params;
  return (
    <AppShell>
      <Suspense
        fallback={
          <div aria-busy="true">
            <SkeletonTiles count={3} label="Loading cash position" />
            <SkeletonCard label="Loading collections" lines={3} />
          </div>
        }
      >
        <CashWorkspace />
      </Suspense>
    </AppShell>
  );
}
