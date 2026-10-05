import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';

import { ProductionSafeOverview } from './_overview/overview-dashboard';

export const metadata = {
  title: 'Dashboard',
};

/** Owner/Finance overview. Live figures stay hidden until reporting data exists. */
export default function OverviewPage() {
  return (
    <AppShell navigationProjection={syntheticNavigationProjection} searchPlacement="header">
      <ProductionSafeOverview />
    </AppShell>
  );
}
