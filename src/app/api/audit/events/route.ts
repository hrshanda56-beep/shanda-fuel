import { NextResponse } from 'next/server';
import { listAuditEventsFromRequest } from '../../../../modules/audit/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

/** The organisation's audit log: who changed what, and when. Needs the audit permission. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return NextResponse.json(await listAuditEventsFromRequest(request, params), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
