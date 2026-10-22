import 'server-only';

import Link from 'next/link';
import { ContextRequiredState } from '@/design-system/primitives';
import { ServerDataPage, type PageSearch } from '@/modules/context/server-page';
import { parseReportFilters, resolveReportFilters } from '../filters';
import { businessToday } from '../period';
import { findTableReport } from './definitions';
import { runTableReport } from './run';
import { TableReportTable } from './ui/table-report-table';
import { TableReportToolbar } from './ui/table-report-toolbar';

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
        if (!range) return { tenantId, filters, range: null, result: null };
        const result = await runTableReport(request, slug, {
          tenantId,
          stationIds: filters.stationIds.join(','),
          ...range,
        });
        return { tenantId, filters, range, result };
      }}
      render={(data) =>
        data && definition ? (
          <div className="reports-stack wide-workspace">
            <p>
              <Link href={`/reports?tenantId=${encodeURIComponent(data.tenantId)}`}>
                ← All reports
              </Link>
            </p>
            <p className="field-hint">{definition.description}</p>
            {data.range ? (
              <>
                <TableReportToolbar
                  tenantId={data.tenantId}
                  slug={slug}
                  period={data.filters.period}
                  fromDate={data.range.fromDate}
                  toDate={data.range.toDate}
                />
                {data.result ? (
                  <TableReportTable
                    definition={definition}
                    rows={data.result.rows}
                    truncated={data.result.truncated}
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
