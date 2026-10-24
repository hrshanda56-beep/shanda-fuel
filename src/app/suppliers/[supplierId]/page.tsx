import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import {
  getSupplierSummaryFromRequest,
  getSupplierStatementFromRequest,
} from '@/modules/creditors/queries';
import { SupplierDetailWorkspace } from '@/modules/creditors/ui/supplier-detail-workspace';
export const metadata = { title: 'Suppliers' };
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId: id } = await params;
  const search = await searchParams;
  const pathname = `/suppliers/${id}`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<SupplierDetailWorkspace supplierId={id} />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        if (!current.legalEntityId) return null;
        const input = {
          tenantId: current.organisationId,
          legalEntityId: current.legalEntityId,
          supplierId: id,
        };
        return Promise.all([
          getSupplierSummaryFromRequest(request, input),
          getSupplierStatementFromRequest(request, input),
        ]);
      }}
      render={(data, resolution) =>
        data ? (
          <SupplierDetailWorkspace
            key={JSON.stringify(resolution.current) + id}
            supplierId={id}
            initial={{ resolution, supplier: data[0][0] ?? null, statement: data[1] }}
          />
        ) : (
          <ContextRequiredState
            title="Choose a work context"
            message="Use the selector above to choose an authorized context."
          />
        )
      }
    />
  );
}
