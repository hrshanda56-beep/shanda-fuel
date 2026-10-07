import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import {
  ProductionReconciliationWorkflow,
  type ProductionReconciliationContext,
} from '@/modules/forecourt/ui/production-reconciliation-workflow';

export const metadata = { title: 'Review reconciliation' };

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
      breadcrumbs={[
        { label: 'Reconciliations', href: '/stations/demo/reconciliations' },
        { label: 'Management review' },
      ]}
    >
      {productionContext ? (
        <ProductionReconciliationWorkflow context={productionContext} role="MANAGEMENT" />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
