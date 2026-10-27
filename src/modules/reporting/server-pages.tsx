import Link from 'next/link';
import { ReportsRail } from './ui/reports-rail';
import 'server-only';
import { Suspense } from 'react';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { ContextRequiredState, LoadingState } from '@/design-system/primitives';
import { ManagementReportDashboard } from './ui/management-report-dashboard';
import { QuickLook } from './ui/quick-look';
import { RecentActivity } from './ui/reports-rail';
import { ReportList } from './ui/report-list';
import { canViewFinanceReports, getManagementReportFromRequest } from './queries';
import { listRecentReportActivity } from './report-events';
import { parseReportFilters, resolveReportFilters } from './filters';
import { businessToday, precedingRange, resolvePeriod } from './period';
import { findReport, type ReportDefinition } from './catalog';

function searchParams(search: PageSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}
const required = (
  <ContextRequiredState
    title="Choose an organisation to view reports"
    message="Use the work context selector above to choose an organisation."
  />
);
export function ServerReportDetail({
  search,
  view,
}: {
  search: PageSearch;
  view: ReportDefinition['slug'];
}) {
  return (
    <ServerDataPage
      pathname={`/reports/${view}`}
      search={search}
      shell={{ pageSubtitle: findReport(view)?.title }}
      fallback={
        typeof search.tenantId === 'string' ? (
          <ManagementReportDashboard tenantId={search.tenantId} view={view} />
        ) : (
          required
        )
      }
      load={async (request, resolution) => {
        if (!resolution.current) return null;
        const tenantId = resolution.current.organisationId;
        const filters = parseReportFilters(searchParams(search));
        const range = resolveReportFilters(filters, businessToday());
        if (!range) return { tenantId, report: null, previous: null };
        const input = { tenantId, stationIds: filters.stationIds.join(','), ...range };
        const before = precedingRange(range.fromDate, range.toDate);
        const [report, previous] = await Promise.all([
          getManagementReportFromRequest(request, input),
          getManagementReportFromRequest(request, { ...input, ...before }).catch(() => null),
        ]);
        return { tenantId, report, previous };
      }}
      render={(result) =>
        result ? (
          <>
            <p>
              <Link href={`/reports?tenantId=${encodeURIComponent(result.tenantId)}`}>
                ← All reports
              </Link>
            </p>
            <ManagementReportDashboard
              key={JSON.stringify([result.tenantId, search, view])}
              tenantId={result.tenantId}
              view={view}
              initialData={{ report: result.report, previous: result.previous }}
            />
          </>
        ) : (
          required
        )
      }
    />
  );
}
export function ServerReportsIndex({ search }: { search: PageSearch }) {
  return (
    <ServerDataPage
      pathname="/reports"
      search={search}
      shell={{ pageSubtitle: 'Operational Financial Position' }}
      fallback={
        typeof search.tenantId === 'string' ? (
          <div className="reports-stack wide-workspace">
            <div className="reports-layout">
              <ReportList tenantId={search.tenantId} />
              <ReportsRail tenantId={search.tenantId} />
            </div>
          </div>
        ) : (
          required
        )
      }
      load={async (request, resolution) =>
        resolution.current
          ? {
              request,
              tenantId: resolution.current.organisationId,
              financeReports: await canViewFinanceReports(
                request,
                resolution.current.organisationId,
              ),
            }
          : null
      }
      render={(result) =>
        result ? (
          <div className="reports-stack wide-workspace">
            <div className="reports-layout">
              <ReportList tenantId={result.tenantId} financeReports={result.financeReports} />
              {result.financeReports ? (
                <aside className="reports-rail" aria-label="Browse reports">
                  <Suspense fallback={<LoadingState label="Loading figures…" />}>
                    <QuickFigures
                      request={result.request}
                      tenantId={result.tenantId}
                      search={search}
                    />
                  </Suspense>
                  <Suspense fallback={<LoadingState label="Loading activity…" />}>
                    <Activity request={result.request} tenantId={result.tenantId} />
                  </Suspense>
                </aside>
              ) : null}
            </div>
          </div>
        ) : (
          required
        )
      }
    />
  );
}
async function QuickFigures({
  request,
  tenantId,
  search,
}: {
  request: Request;
  tenantId: string;
  search: PageSearch;
}) {
  const filters = parseReportFilters(searchParams(search));
  const range = resolvePeriod('this-month', businessToday())!;
  const report = await getManagementReportFromRequest(request, {
    tenantId,
    stationIds: filters.stationIds.join(','),
    ...range,
  }).catch(() => null);
  return (
    <QuickLook
      key={JSON.stringify([tenantId, filters.stationIds])}
      tenantId={tenantId}
      initialData={report}
    />
  );
}
async function Activity({ request, tenantId }: { request: Request; tenantId: string }) {
  const items = await listRecentReportActivity(request, { tenantId }).catch(() => null);
  return <RecentActivity key={tenantId} tenantId={tenantId} initialData={items} />;
}
