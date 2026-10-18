import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getCashStationSummaryFromRequest } from '@/modules/cash/queries';
import { CashWorkspace } from '@/modules/cash/ui/cash-workspace';
export const metadata = { title: 'Cash' };
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ stationId: string }>;
}) {
  const { stationId: id } = await params;
  const search = await searchParams;
  const pathname = `/stations/${id}/cash`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<CashWorkspace />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        if (!current.stationId || current.allStations) return null;
        return getCashStationSummaryFromRequest(request, { selection: current });
      }}
      render={(data, resolution) =>
        data ? (
          <CashWorkspace
            key={JSON.stringify(resolution.current)}
            initial={{ selection: resolution.current!, summary: data }}
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
