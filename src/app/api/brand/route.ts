import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../modules/identity';
import { readCompanyBrandFromRequest } from '../../../modules/sales-documents/brand';
import { apiErrorResponse, withRequestObservability } from '../../../platform/observability';

export const runtime = 'nodejs';

/**
 * The company's logo and colour, for the loading screen. Read-only. Needs a signed-in member of the
 * company; the answer is for that person only, so it is never stored by shared caches.
 */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const actor = await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const brand = await readCompanyBrandFromRequest(
      request,
      { tenantId: url.searchParams.get('tenantId') },
      actor,
    );
    return NextResponse.json(
      { data: brand },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: false,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
});
