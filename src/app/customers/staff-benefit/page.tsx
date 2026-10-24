import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getCustomerAccountsFromRequest } from '@/modules/customers/queries';
import { getStaffBenefitAccountsFromRequest } from '@/modules/customers/staff-benefit-read';
import { StaffBenefitWorkspace } from '@/modules/customers/ui/staff-benefit-workspace';

export const metadata = { title: 'Staff fuel benefit' };

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname="/customers/staff-benefit"
      search={search}
      fallback={
        <ContextRequiredState
          title="Choose a work context"
          message="Use the selector above to choose an authorized context."
        />
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        const [rows, accounts] = await Promise.all([
          getStaffBenefitAccountsFromRequest(request, { tenantId: current.organisationId }),
          getCustomerAccountsFromRequest(request, { tenantId: current.organisationId }),
        ]);
        return { rows, accounts };
      }}
      render={(data, resolution) => {
        const current = resolution.current;
        if (!data || !current) {
          return (
            <ContextRequiredState
              title="Choose a work context"
              message="Use the selector above to choose an authorized context."
            />
          );
        }
        const customers = data.accounts.customers
          .filter((customer) => customer.status === 'ACTIVE')
          .map((customer) => ({
            customerId: customer.customerId,
            name: customer.displayName,
            reference: customer.accountReference,
          }));
        return (
          <StaffBenefitWorkspace
            key={JSON.stringify(current)}
            tenantId={current.organisationId}
            rows={[...data.rows]}
            customers={customers}
            canOpenAccount={data.accounts.customers.some(
              (customer) => customer.capabilities.openAccount,
            )}
          />
        );
      }}
    />
  );
}
