import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import {
  ProductionReconciliationWorkflow,
  type ProductionReconciliationContext,
} from '@/modules/forecourt/ui/production-reconciliation-workflow';

export const metadata = { title: 'New reconciliation' };

export default async function NewReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams?: Promise<{
    tenantId?: string;
    businessDayId?: string;
    shiftId?: string;
    reconciliationId?: string;
  }>;
}) {
  const { stationId } = await params;
  const search = (await searchParams) ?? {};
  const productionContext: ProductionReconciliationContext | undefined =
    search.tenantId && search.businessDayId && search.shiftId && search.reconciliationId
      ? {
          tenantId: search.tenantId,
          stationId,
          businessDayId: search.businessDayId,
          shiftId: search.shiftId,
          reconciliationId: search.reconciliationId,
        }
      : undefined;
  return (
    <AppShell
      breadcrumbs={[
        { label: 'Reconciliations', href: '/stations/demo/reconciliations' },
        { label: 'New' },
      ]}
    >
      {productionContext ? (
        <ProductionReconciliationWorkflow context={productionContext} role="SUPERVISOR" />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
