import 'server-only';

import Link from 'next/link';
import { ContextRequiredState } from '@/design-system/primitives';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { parseReportFilters, resolveReportFilters } from '../filters';
import { businessToday } from '../period';
import { TABLE_REPORT_ROW_LIMIT, findTableReport } from './definitions';
import { canExportReports } from '../queries';
import { runTableReport } from './run';
import { TableReportTable } from './ui/table-report-table';
import { TableReportFilteredToolbar } from './ui/table-report-filtered-toolbar';
import { parseNarrowing } from './narrowing';

const required = (
  <ContextRequiredState
    title="Choose an organisation to view reports"
    message="Use the work context selector above to choose an organisation."
  />
);

function toParams(search: PageSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}

/** One table report: choose stations and dates, read the table, download it. */
export function ServerTableReport({ slug, search }: { slug: string; search: PageSearch }) {
  const definition = findTableReport(slug);
  return (
    <ServerDataPage
      pathname={`/reports/${slug}`}
      search={search}
      shell={{ pageSubtitle: definition?.title }}
      fallback={required}
      load={async (request, resolution) => {
        if (!resolution.current || !definition) return null;
        const tenantId = resolution.current.organisationId;
        const params = toParams(search);
        const filters = parseReportFilters(params);
        const range = resolveReportFilters(filters, businessToday());
        const canExport = await canExportReports(request, tenantId);
        if (!range) return { tenantId, filters, range: null, result: null, canExport };
        const result = await runTableReport(
          request,
          slug,
          {
            tenantId,
            stationIds: filters.stationIds.join(','),
            ...range,
            ...parseNarrowing(params, definition.filters ?? []),
          },
          { withFilterOptions: true },
        );
        return { tenantId, filters, range, result, canExport };
      }}
      render={(data) =>
        data && definition ? (
          <div className="reports-stack wide-workspace table-report-page">
            <p>
              <Link href={`/reports?tenantId=${encodeURIComponent(data.tenantId)}`}>
                ← All reports
              </Link>
            </p>
            {data.range ? (
              <>
                <TableReportFilteredToolbar
                  tenantId={data.tenantId}
                  slug={slug}
                  period={data.filters.period}
                  fromDate={data.range.fromDate}
                  toDate={data.range.toDate}
                  filterKeys={definition.filters ?? []}
                  filterOptions={data.result?.filterOptions ?? {}}
                  canExport={data.canExport}
                />
                {data.result?.notice ? (
                  <p className="field-hint" role="status">
                    {data.result.notice}
                  </p>
                ) : data.result ? (
                  <TableReportTable
                    definition={definition}
                    rows={data.result.rows}
                    truncated={data.result.truncated}
                    rowLimit={TABLE_REPORT_ROW_LIMIT}
                  />
                ) : null}
              </>
            ) : (
              <p className="field-hint" role="status">
                Choose both dates, with the start on or before the end.
              </p>
            )}
          </div>
        ) : (
          required
        )
      }
    />
  );
}
