import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  getCustomerCreditLimitOverridesFromRequest,
  getCustomerEntryDetailsFromRequest,
} from '../../../../modules/customers/account-controls';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

/** Details recorded on an account's transactions, and its credit-limit override history. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const input = Object.fromEntries(new URL(request.url).searchParams.entries());
    const [entryDetails, overrides] = await Promise.all([
      getCustomerEntryDetailsFromRequest(request, input),
      getCustomerCreditLimitOverridesFromRequest(request, input),
    ]);
    return NextResponse.json(
      { entryDetails, overrides },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
