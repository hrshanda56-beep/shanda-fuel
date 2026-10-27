import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { listOpeningBalanceBatchesFromRequest } from '@/modules/opening-balances/queries';
import { OpeningBalanceWorkspace } from '@/modules/opening-balances/ui/opening-balance-workspace';

export const metadata = { title: 'Opening balances' };
export const dynamic = 'force-dynamic';

export default async function OpeningBalancesPage({
  searchParams,
}: {
  searchParams: Promise<PageSearch>;
}) {
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname="/go-live/opening-balances"
      search={{ ...search, allStations: 'true', stationId: undefined }}
      shell={{ pageSubtitle: 'Bring the opening figures into Shanda Fuel before go-live.' }}
      fallback={
        <ContextRequiredState
          title="Choose an organisation"
          message="Choose an authorised organisation before importing opening balances."
        />
      }
      load={async (request, resolution) => {
        if (!resolution.current) return null;
        const tenantId = resolution.current.organisationId;
        const batches = await listOpeningBalanceBatchesFromRequest(request, tenantId);
        return { tenantId, batches };
      }}
      render={(data) =>
        data ? (
          <OpeningBalanceWorkspace tenantId={data.tenantId} initialBatches={data.batches} />
        ) : (
          <ContextRequiredState
            title="Choose an organisation"
            message="Choose an authorised organisation before importing opening balances."
          />
        )
      }
    />
  );
}
