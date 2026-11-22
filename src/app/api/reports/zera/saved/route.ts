import { NextResponse } from 'next/server';
import {
  listZeraReturnsFromRequest,
  saveZeraReturnFromRequest,
} from '../../../../../modules/reporting/zera/save-zera';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../../platform/security';

const noStore = { 'Cache-Control': 'no-store' };

/** The returns already saved for one station. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    return NextResponse.json(
      await listZeraReturnsFromRequest(request, Object.fromEntries(url.searchParams.entries())),
      { headers: noStore },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true, headers: noStore });
  }
});

/** Saves the licence details and the return as a new version. */
export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      return NextResponse.json(await saveZeraReturnFromRequest(request, await request.json()), {
        headers: noStore,
      });
    } catch (error) {
      return apiErrorResponse(request, error, { includeDetails: true, headers: noStore });
    }
  }, WRITE_RATE_LIMIT),
);
