import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { OperationsDashboard } from '@/modules/reporting/ui/operations-dashboard';

export const metadata = {
  title: { absolute: 'Dashboard · Shanda Fuel' },
};

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const { tenantId, stationId } = await searchParams;

  return (
    <AppShell navigationProjection={syntheticNavigationProjection} searchPlacement="header">
      <OperationsDashboard tenantId={tenantId} stationId={stationId} />
    </AppShell>
  );
}
