import { NextResponse } from 'next/server';
import {
  getManagementReportExportMetadata,
  serializeManagementReportCsv,
} from '../../../../../modules/reporting/export';
import { getManagementReportFromRequest } from '../../../../../modules/reporting/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const report = await getManagementReportFromRequest(
      request,
      Object.fromEntries(url.searchParams.entries()),
      { permissionCode: 'report.export' },
    );
    const generatedAt = new Date().toISOString();
    const metadata = getManagementReportExportMetadata(report, { generatedAt });
    const date = report.filters.toDate.replaceAll('-', '');
    const csv = serializeManagementReportCsv(report, { generatedAt });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="management-report-${date}.csv"`,
        'X-Content-Type-Options': 'nosniff',
        'X-Report-Empty': String(metadata.emptyReport),
        'X-Report-Generated-At': generatedAt,
        'X-Report-Scope': report.filters.stationId ? 'STATION' : 'TENANT',
      },
    });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
