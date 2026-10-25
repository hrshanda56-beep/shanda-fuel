import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getAccountControlsPageDataFromRequest } from '@/modules/customers/account-controls';
import { getCustomerAccountsFromRequest } from '@/modules/customers/queries';
import { AccountControlsWorkspace } from '@/modules/customers/ui/account-controls-workspace';

export const metadata = { title: 'Customer controls' };

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname="/customers/account-controls"
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
        const [accounts, controls] = await Promise.all([
          getCustomerAccountsFromRequest(request, { tenantId: current.organisationId }),
          getAccountControlsPageDataFromRequest(request, { tenantId: current.organisationId }),
        ]);
        return { accounts, controls };
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
        const organisation = resolution.available.organisations.find(
          (item) => item.id === current.organisationId,
        );
        const stations = (organisation?.legalEntities ?? []).flatMap((legalEntity) =>
          legalEntity.stations.map((station) => ({
            id: station.id,
            name: station.name,
            code: station.code,
            legalEntityId: legalEntity.id,
          })),
        );
        return (
          <AccountControlsWorkspace
            key={JSON.stringify(current)}
            tenantId={current.organisationId}
            currentStationId={current.stationId ?? null}
            customers={[...data.accounts.customers]}
            stations={stations}
            approvers={[...data.controls.approvers]}
            canOverrideLimit={data.controls.canOverrideLimit}
            canRecordDetails={data.controls.canRecordDetails}
          />
        );
      }}
    />
  );
}
