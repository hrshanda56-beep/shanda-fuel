import { AppShell } from '@/design-system/app-shell';
import { PageHeader } from '@/design-system/layout';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ContextRequiredState } from '@/design-system/primitives';
import { SettlementWorkspace } from '@/modules/settlements/ui/settlement-workspace';

export default async function SettlementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId } = await params;
  const query = await searchParams;
  const tenantId = typeof query.tenantId === 'string' ? query.tenantId : '';
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'ShandaHR',
        station: stationId,
        businessDate: 'Current',
        shift: 'Finance',
      }}
      role="Finance"
      userName="Current user"
      breadcrumbs={[{ label: 'Provider settlements' }]}
    >
      {tenantId ? (
        <SettlementWorkspace tenantId={tenantId} stationId={stationId} />
      ) : (
        <>
          <PageHeader
            eyebrow="Electronic payment control"
            title="Provider settlements"
            description="Match provider settlements to the payment evidence in daily reconciliations."
          />
          <ContextRequiredState
            title="Select a tenant context"
            message="A trusted tenant and station context is required before settlement data can be loaded."
          />
        </>
      )}
    </AppShell>
  );
}
