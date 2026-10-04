import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';

import { OverviewDashboard, ProductionSafeOverview } from './_overview/overview-dashboard';
import { sampleContext, sampleTasks } from './_overview/sample-overview';

/**
 * Owner/Finance overview. The sample presentation is available for local
 * design review only; production never renders synthetic figures.
 */
export default function OverviewPage() {
  const isProduction = process.env.NODE_ENV === 'production';

  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={isProduction ? undefined : sampleContext}
      role={isProduction ? undefined : 'Owner'}
      userName={isProduction ? undefined : 'Demo owner'}
      openTasks={isProduction ? undefined : sampleTasks}
      searchPlacement="page"
    >
      {isProduction ? <ProductionSafeOverview /> : <OverviewDashboard />}
    </AppShell>
  );
}
