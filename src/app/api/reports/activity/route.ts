import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listRecentReportActivity } from '../../../../modules/reporting/report-events';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

/** The signed-in user's own recent report shares and exports. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const tenantId = z.string().uuid().parse(new URL(request.url).searchParams.get('tenantId'));
    return NextResponse.json(
      { data: await listRecentReportActivity(request, { tenantId }) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
