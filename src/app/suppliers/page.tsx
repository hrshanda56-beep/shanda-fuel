import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getSupplierSummaryFromRequest } from '@/modules/creditors/queries';
import { SupplierWorkspace } from '@/modules/creditors/ui/supplier-workspace';
export const metadata = { title: 'Suppliers' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const pathname = `/suppliers`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<SupplierWorkspace />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        if (!current.legalEntityId) return null;
        const input = { tenantId: current.organisationId, legalEntityId: current.legalEntityId };
        return getSupplierSummaryFromRequest(request, input);
      }}
      render={(data, resolution) =>
        data ? (
          <SupplierWorkspace
            key={JSON.stringify(resolution.current)}
            initial={{ resolution, rows: data }}
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
