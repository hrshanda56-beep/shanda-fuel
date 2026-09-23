import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { DailyReconciliationWorkflow } from '@/modules/forecourt/ui/daily-reconciliation-workflow';

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ stationId: string; id: string }>;
}) {
  await params;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'TEI Oils',
        station: 'Main service station',
        businessDate: '20 Sep 2026',
        shift: 'Morning shift',
      }}
      role="Supervisor"
      userName="Demo supervisor"
      breadcrumbs={[
        { label: 'Reconciliations', href: '/stations/demo/reconciliations' },
        { label: 'Morning shift' },
      ]}
    >
      <DailyReconciliationWorkflow role="SUPERVISOR" />
    </AppShell>
  );
}
