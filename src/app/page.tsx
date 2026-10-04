import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';

import { OverviewDashboard } from './_overview/overview-dashboard';
import { sampleContext, sampleTasks } from './_overview/sample-overview';

/**
 * Owner/Finance overview. The dashboard is deliberately labelled as sample
 * presentation data until the server reporting projection supplies values.
 */
export default function OverviewPage() {
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={sampleContext}
      role="Owner"
      userName="Demo owner"
      openTasks={sampleTasks}
      searchPlacement="page"
    >
      <OverviewDashboard />
    </AppShell>
  );
}
