import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getCustomerAccountsFromRequest } from '@/modules/customers/queries';
import { CustomerDetailWorkspace } from '@/modules/customers/ui/customer-detail-workspace';
export const metadata = { title: 'Customers' };
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ customerId: string }>;
}) {
  const { customerId: id } = await params;
  const search = await searchParams;
  const pathname = `/customers/${id}`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<CustomerDetailWorkspace customerId={id} />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        return getCustomerAccountsFromRequest(request, {
          tenantId: current.organisationId,
          customerId: id,
        });
      }}
      render={(data, resolution) =>
        data ? (
          <CustomerDetailWorkspace
            key={JSON.stringify(resolution.current) + id}
            customerId={id}
            initial={{ resolution, customer: data.customers[0] ?? null }}
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
