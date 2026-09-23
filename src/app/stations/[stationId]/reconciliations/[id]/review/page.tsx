import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { DailyReconciliationWorkflow } from '@/modules/forecourt/ui/daily-reconciliation-workflow';
import {
  ProductionReconciliationWorkflow,
  type ProductionReconciliationContext,
} from '@/modules/forecourt/ui/production-reconciliation-workflow';

export default async function ReconciliationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string; id: string }>;
  searchParams?: Promise<{
    tenantId?: string;
    businessDayId?: string;
    shiftId?: string;
  }>;
}) {
  const { stationId, id } = await params;
  const search = (await searchParams) ?? {};
  const productionContext: ProductionReconciliationContext | undefined =
    search.tenantId && search.businessDayId && search.shiftId
      ? {
          tenantId: search.tenantId,
          stationId,
          businessDayId: search.businessDayId,
          shiftId: search.shiftId,
          reconciliationId: id,
        }
      : undefined;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'TEI Oils',
        station: 'Main service station',
        businessDate: '20 Sep 2026',
        shift: 'Morning shift',
      }}
      role="Management"
      userName="Demo manager"
      breadcrumbs={[
        { label: 'Reconciliations', href: '/stations/demo/reconciliations' },
        { label: 'Management review' },
      ]}
    >
      {productionContext ? (
        <ProductionReconciliationWorkflow context={productionContext} role="MANAGEMENT" />
      ) : (
        <DailyReconciliationWorkflow role="MANAGEMENT" />
      )}
    </AppShell>
  );
}
