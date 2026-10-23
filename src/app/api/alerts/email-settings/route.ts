import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  getAlertEmailFromRequest,
  setAlertEmailEnabledFromRequest,
  setMyAlertEmailFromRequest,
} from '../../../../modules/alerts/settings';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

const noStore = { 'Cache-Control': 'no-store' };

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return NextResponse.json(await getAlertEmailFromRequest(request, params), {
      headers: noStore,
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      const body: unknown = await request.json();
      const scope =
        typeof body === 'object' && body !== null && 'scope' in body
          ? (body as { scope?: unknown }).scope
          : undefined;
      if (scope !== 'ORGANISATION' && scope !== 'ME') {
        return NextResponse.json({ message: 'A supported scope is required' }, { status: 400 });
      }
      const result =
        scope === 'ORGANISATION'
          ? await setAlertEmailEnabledFromRequest(request, body)
          : await setMyAlertEmailFromRequest(request, body);
      return NextResponse.json(result, { status: 200, headers: noStore });
    } catch (error) {
      return apiErrorResponse(request, error, { includeDetails: true, headers: noStore });
    }
  }, WRITE_RATE_LIMIT),
);
