import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getCustomerAccountsFromRequest } from '@/modules/customers/queries';
import { CustomerWorkspace } from '@/modules/customers/ui/customer-workspace';
export const metadata = { title: 'Customers' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const pathname = `/customers`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<CustomerWorkspace />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        return getCustomerAccountsFromRequest(request, { tenantId: current.organisationId });
      }}
      render={(data, resolution) =>
        data ? (
          <CustomerWorkspace
            key={JSON.stringify(resolution.current)}
            initial={{ resolution, customers: [...data.customers] }}
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
