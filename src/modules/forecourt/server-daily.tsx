import 'server-only';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import {
  DailyOperationsWorkspace,
  DailyOperationsContextRequired,
  type DailyOperationsContext,
} from './ui/daily-operations-workspace';
import { getDailyOperationsContextFromRequest, dailyOperationsQuery } from './daily-operations';
import { getProductionReconciliationFromRequest } from './production-reconciliation';
import { getCashStationSummaryFromRequest } from '../cash/queries';
import { getProviderSettlementSummaryFromRequest } from '../settlements/queries';
import { AppError } from '@/platform/errors';
export function ServerDailyOperations({
  search,
  context,
}: {
  search: PageSearch;
  context: DailyOperationsContext;
}) {
  return (
    <ServerDataPage
      pathname="/operations/daily"
      search={search}
      fallback={<DailyOperationsWorkspace context={context} />}
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || current.allStations) return null;
        const input = dailyOperationsQuery.parse({
          ...context,
          tenantId: current.organisationId,
          stationId: current.stationId,
        });
        const record = context.reconciliationId
          ? getProductionReconciliationFromRequest(request, {
              ...input,
              reconciliationId: context.reconciliationId,
            }).catch((error) => {
              if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
              throw error;
            })
          : Promise.resolve(null);
        const [operation, reconciliation, cash, settlements] = await Promise.all([
          getDailyOperationsContextFromRequest(request, input),
          record,
          getCashStationSummaryFromRequest(request, { selection: current })
            .then((row) => row.totals)
            .catch(() => undefined),
          getProviderSettlementSummaryFromRequest(request, input).catch(() => []),
        ]);
        return { operation, record: reconciliation, cash, settlements };
      }}
      render={(data, resolution) =>
        data ? (
          <DailyOperationsWorkspace
            key={JSON.stringify([resolution.current, context])}
            context={{
              ...context,
              tenantId: resolution.current!.organisationId,
              stationId: resolution.current!.stationId!,
            }}
            initialData={data}
          />
        ) : (
          <DailyOperationsContextRequired />
        )
      }
    />
  );
}
