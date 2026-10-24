import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState, EmptyState } from '@/design-system/primitives';
import { listSupplierPaymentsWithProofFromRequest } from '@/modules/creditors/payment-proof-queries';
import { getSupplierSummaryFromRequest } from '@/modules/creditors/queries';
import { SupplierPaymentProofView } from '@/modules/creditors/ui/supplier-payment-proof-view';

export const metadata = { title: 'Supplier payments' };

export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) query.set(key, first);
  }
  return (
    <ServerDataPage
      pathname={`/suppliers/${supplierId}/payments`}
      search={search}
      fallback={<EmptyState title="Supplier payments" message="Loading your work context." />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.legalEntityId) return null;
        const input = {
          tenantId: current.organisationId,
          legalEntityId: current.legalEntityId,
          supplierId,
        };
        const [summary, payments] = await Promise.all([
          getSupplierSummaryFromRequest(request, input),
          listSupplierPaymentsWithProofFromRequest(request, input),
        ]);
        return { supplier: summary[0] ?? null, payments };
      }}
      render={(data, resolution) =>
        data && resolution.current ? (
          data.supplier ? (
            <SupplierPaymentProofView
              supplierName={data.supplier.legalName}
              supplierId={supplierId}
              payments={data.payments}
              selection={resolution.current}
              search={query.toString()}
            />
          ) : (
            <EmptyState
              title="Supplier not found in this context"
              message="This supplier may belong to a different company."
            />
          )
        ) : (
          <ContextRequiredState
            title="Choose a work context"
            message="Use the selector above to choose a company."
          />
        )
      }
    />
  );
}
