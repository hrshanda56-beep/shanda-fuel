import { ServerDataPage } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { dailyReportQuery, getDailyReportFromRequest } from '@/modules/forecourt/daily-report';
import { DailyReportView } from '@/modules/forecourt/ui/daily-report';

export const metadata = { title: 'Daily report' };

export default async function OperationsDailyReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  return (
    <ServerDataPage
      pathname={`/operations/reconciliations/${id}/report`}
      search={search}
      shell={{
        breadcrumbs: [
          { label: 'Operations', href: '/operations/daily' },
          { label: 'Daily report' },
        ],
      }}
      fallback={
        <ContextRequiredState
          title="Choose a station"
          message="Pick one station to see its daily report."
        />
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current?.stationId || current.allStations) return null;
        return getDailyReportFromRequest(
          request,
          dailyReportQuery.parse({
            tenantId: current.organisationId,
            stationId: current.stationId,
            reconciliationId: id,
          }),
        );
      }}
      render={(report) =>
        report ? (
          <DailyReportView report={report} />
        ) : (
          <ContextRequiredState
            title="Choose a station"
            message="Pick one station to see its daily report."
          />
        )
      }
    />
  );
}
