import { NextResponse } from 'next/server';
import { getSalesDocumentProfileFromRequest } from '../../../../modules/sales-documents/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

/**
 * A company's saved details for quotations and invoices (name, address, tax number, bank details),
 * read when someone opens the company-details guide from Settings. Same permission as the page
 * that already shows them; nothing is changed here.
 */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const profile = await getSalesDocumentProfileFromRequest(request, params);
    return NextResponse.json({ profile }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { headers: { 'Cache-Control': 'no-store' } });
  }
});
