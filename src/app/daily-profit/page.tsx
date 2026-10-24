import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState } from '@/design-system/primitives';
import { getManagementReportFromRequest } from '@/modules/reporting/queries';
import { parseReportFilters, resolveReportFilters } from '@/modules/reporting/filters';
import { businessToday } from '@/modules/reporting/period';
import { DailyProfitWorkspace } from '@/modules/owner/ui/daily-profit-workspace';

export const metadata = { title: 'Daily profit' };
export const dynamic = 'force-dynamic';

function messageFor(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/forbidden|permission|not allowed|denied/i.test(message))
    return 'You do not have access to these figures for these stations. Ask the owner to give you access to reports.';
  return 'Something went wrong while adding up the figures. Nothing has been changed. Try again in a moment.';
}

export default async function Page({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return (
    <ServerDataPage
      pathname="/daily-profit"
      search={search}
      shell={{ pageSubtitle: 'What the business made each day' }}
      fallback={
        <ContextRequiredState
          title="Choose a work context"
          message="Use the selector above to choose an organisation."
        />
      }
      load={async (request, resolution) => {
        const current = resolution.current;
        if (!current) return null;
        const tenantId = current.organisationId;
        const filters = parseReportFilters(params);
        const range = resolveReportFilters(filters, businessToday());
        const base = { tenantId, report: null, error: null, badRange: false };
        if (!range) return { ...base, badRange: true };
        try {
          const report = await getManagementReportFromRequest(request, {
            tenantId,
            stationIds: filters.stationIds.join(','),
            fromDate: range.fromDate,
            toDate: range.toDate,
          });
          return { ...base, report };
        } catch (error) {
          return { ...base, error: messageFor(error) };
        }
      }}
      render={(data) =>
        data ? (
          <DailyProfitWorkspace key={JSON.stringify([data.tenantId, search])} initial={data} />
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
