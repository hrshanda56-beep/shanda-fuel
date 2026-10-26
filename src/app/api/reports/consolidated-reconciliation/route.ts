import { NextResponse } from 'next/server';
import { buildConsolidatedReconciliationReadModel } from '../../../../modules/reporting/consolidated-reconciliation';
import { getDailyOperationsFromRequest } from '../../../../modules/reporting/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const daily = await getDailyOperationsFromRequest(
      request,
      Object.fromEntries(url.searchParams.entries()),
    );
    return NextResponse.json(
      {
        state: daily.state,
        filters: daily.filters,
        dateBasis: daily.dateBasis,
        ...buildConsolidatedReconciliationReadModel(daily.rows),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
