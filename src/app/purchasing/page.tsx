import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getPurchasingCapabilitiesFromRequest } from '@/modules/purchasing/capabilities';
import { PurchasingWorkspace } from '@/modules/purchasing/ui/purchasing-workspace';
export const metadata = { title: 'Purchasing' };
export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname="/purchasing"
      search={search}
      fallback={
        <ContextRequiredState
          title="Choose a work context"
          message="Use the selector above to choose a company."
        />
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.legalEntityId) return null;
        return getPurchasingCapabilitiesFromRequest(request, current.organisationId);
      }}
      render={(capabilities, resolution) =>
        capabilities ? (
          <PurchasingWorkspace
            key={JSON.stringify(resolution.current)}
            resolution={resolution}
            capabilities={capabilities}
          />
        ) : (
          <ContextRequiredState
            title="Choose a company"
            message="Use the selector above to choose the company whose purchasing you want to see."
          />
        )
      }
    />
  );
}
