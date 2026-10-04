import { Suspense } from 'react';
import { AppShell } from '@/design-system/app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { CashWorkspace } from '@/modules/cash/ui/cash-workspace';

export default async function CashPage({ params }: { params: Promise<{ stationId: string }> }) {
  await params;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      breadcrumbs={[{ label: 'Cash and banking' }]}
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">Cash and banking</p>
          <h1>Station collections</h1>
          <p className="lede">
            Track custody, collection allocation, and distinct bank confirmation.
          </p>
        </div>
      </div>
      <Suspense
        fallback={
          <ContextRequiredState
            title="Checking station context"
            message="Cash loads only after the shared work context has confirmed one authorised station."
          />
        }
      >
        <CashWorkspace />
      </Suspense>
    </AppShell>
  );
}
