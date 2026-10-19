import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDashboardSalesFromRequest } from '@/modules/reporting/queries';
import { apiErrorResponse, withRequestObservability } from '@/platform/observability';
const query = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export const GET = withRequestObservability(async (request: Request) => {
  try {
    const { stationId, ...input } = query.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return NextResponse.json(
      await getDashboardSalesFromRequest(request, {
        ...input,
        ...(stationId ? { stationIds: stationId } : {}),
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: false });
  }
});
