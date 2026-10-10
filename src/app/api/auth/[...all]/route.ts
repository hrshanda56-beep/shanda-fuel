import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '../../../../platform/auth';
import { getAuthProviderName } from '../../../../platform/auth/provider';
import { withRequestObservability } from '../../../../platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

export const runtime = 'nodejs';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  if (getAuthProviderName() === 'CLERK') return new Response(null, { status: 404 });
  return toNextJsHandler(getAuth()).GET(request);
});

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    if (getAuthProviderName() === 'CLERK') return new Response(null, { status: 404 });
    return toNextJsHandler(getAuth()).POST(request);
  }, AUTH_RATE_LIMIT),
);
