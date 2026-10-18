import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getSettlementOverviewFromRequest } from '@/modules/settlements/queries';
import { SettlementWorkspace } from '@/modules/settlements/ui/settlement-workspace';
import { buildContextHref } from '@/modules/context';
export const metadata = { title: 'Settlements' };
export default async function Page({
  searchParams,
  params,
}: {
  searchParams: Promise<PageSearch>;
  params: Promise<{ stationId: string }>;
}) {
  const { stationId: id } = await params;
  const search = await searchParams;
  const pathname = `/stations/${id}/settlements`;
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={<SettlementWorkspace stationId={id} />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        if (!current.stationId || current.allStations || current.stationId !== id) return null;
        return getSettlementOverviewFromRequest(request, {
          tenantId: current.organisationId,
          stationId: id,
        });
      }}
      render={(data, resolution) =>
        data ? (
          <SettlementWorkspace
            key={JSON.stringify(resolution.current)}
            stationId={id}
            initial={{
              ...data,
              context: {
                ...resolution.current!,
                canonicalHref: buildContextHref(pathname, '', resolution.current!),
              },
            }}
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
