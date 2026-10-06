import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';

import { ProductionSafeOverview } from './_overview/overview-dashboard';

export const metadata = {
  title: { absolute: 'Dashboard · Shanda Fuel' },
};

/** Owner/Finance overview. Live figures stay hidden until reporting data exists. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      searchPlacement="header"
      pageSubtitle={tenantId ? 'Operational control and exception visibility' : undefined}
    >
      {tenantId ? <ManagementReportDashboard tenantId={tenantId} /> : <ProductionSafeOverview />}
    </AppShell>
  );
}
