import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';

import { OverviewDashboard } from './_overview/overview-dashboard';
import { sampleAttention, sampleContext, sampleTasks } from './_overview/sample-overview';

export default function OverviewPage() {
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={sampleContext}
      role="Owner"
      userName="Demo owner"
      openTasks={sampleTasks}
      attentionCount={sampleAttention.length}
      searchPlacement="page"
    >
      <OverviewDashboard />
    </AppShell>
  );
}
