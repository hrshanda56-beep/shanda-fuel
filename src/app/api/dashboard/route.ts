import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDashboardFromRequest } from '../../../modules/dashboard/queries';
import { apiErrorResponse, withRequestObservability } from '../../../platform/observability';
export const runtime = 'nodejs';
const query = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export const GET = withRequestObservability(async (request: Request) => {
  try {
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await getDashboardFromRequest(request, input), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: false });
  }
});
