import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { SettlementWorkspace } from '@/modules/settlements/ui/settlement-workspace';

export default async function SettlementsPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      breadcrumbs={[{ label: 'Provider settlements' }]}
    >
      <SettlementWorkspace stationId={stationId} />
    </AppShell>
  );
}
