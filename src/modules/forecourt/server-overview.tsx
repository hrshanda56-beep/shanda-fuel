import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { OperationsControlRoom } from './ui/operations-control-room';
import { DailyOperationsContextRequired } from './ui/daily-operations-workspace';
import { getOperationsOverviewFromRequest } from './operations-overview';
export function ServerOperationsOverview({
  search,
  stationId,
  focus = 'operations',
}: {
  search: PageSearch;
  stationId?: string;
  focus?: 'operations' | 'reconciliations';
}) {
  const tenantId = typeof search.tenantId === 'string' ? search.tenantId : undefined;
  const fallbackStationId =
    stationId ?? (typeof search.stationId === 'string' ? search.stationId : undefined);
  const pathname = stationId
    ? `/stations/${stationId}/reconciliations`
    : focus === 'reconciliations'
      ? '/operations/reconciliations'
      : '/operations/daily';
  return (
    <ServerDataPage
      pathname={pathname}
      search={search}
      fallback={
        tenantId && fallbackStationId ? (
          <OperationsControlRoom
            context={{
              tenantId,
              stationId: fallbackStationId,
              businessDayId:
                typeof search.businessDayId === 'string' ? search.businessDayId : undefined,
            }}
            focus={focus}
          />
        ) : (
          <DailyOperationsContextRequired />
        )
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || current.allStations) return null;
        const businessDayId =
          typeof search.businessDayId === 'string' ? search.businessDayId : undefined;
        const context = {
          tenantId: current.organisationId,
          stationId: current.stationId,
          businessDayId,
        };
        return { context, overview: await getOperationsOverviewFromRequest(request, context) };
      }}
      render={(result) =>
        result ? (
          <OperationsControlRoom
            key={JSON.stringify(result.context)}
            context={result.context}
            focus={focus}
            initialData={result.overview}
          />
        ) : (
          <DailyOperationsContextRequired />
        )
      }
    />
  );
}
