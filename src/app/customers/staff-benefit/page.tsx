import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getCustomerAccountsFromRequest } from '@/modules/customers/queries';
import { getStaffBenefitAccountsFromRequest } from '@/modules/customers/staff-benefit-read';
import { getStaffBenefitStaffOptionsFromRequest } from '@/modules/customers/staff-benefit-staff-read';
import { staffRecordsWithoutBenefit } from '@/modules/customers/staff-records';
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
        const [rows, accounts, staff] = await Promise.all([
          getStaffBenefitAccountsFromRequest(request, { tenantId: current.organisationId }),
          getCustomerAccountsFromRequest(request, { tenantId: current.organisationId }),
          getStaffBenefitStaffOptionsFromRequest(request, { tenantId: current.organisationId }),
        ]);
        return { rows, accounts, staff };
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
        // A staff account needs a company so its month follows that company's station time. With
        // one company in the organisation there is nothing to choose, so it is used.
        const companies =
          resolution.available.organisations.find((org) => org.id === current.organisationId)
            ?.legalEntities ?? [];
        const legalEntityId =
          current.legalEntityId ?? (companies.length === 1 ? companies[0]!.id : undefined);
        const customers = staffRecordsWithoutBenefit(
          data.accounts.customers,
          new Set(data.rows.map((row) => row.customerId)),
        );
        return (
          <StaffBenefitWorkspace
            key={JSON.stringify(current)}
            tenantId={current.organisationId}
            rows={[...data.rows]}
            customers={customers}
            staff={[...data.staff]}
            canOpenAccount={data.accounts.capabilities.openAccount}
            legalEntityId={legalEntityId}
          />
        );
      }}
    />
  );
}
