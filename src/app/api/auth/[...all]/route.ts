import { getAuth } from '../../../../platform/auth';
import { getAuthProviderName } from '../../../../platform/auth/provider';
import { withRequestObservability } from '../../../../platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

export const runtime = 'nodejs';

async function handler(method: 'GET' | 'POST', request: Request): Promise<Response> {
  const { toNextJsHandler } = await import('better-auth/next-js');
  const auth = await getAuth();
  return toNextJsHandler(auth)[method](request);
}

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  if (getAuthProviderName() === 'CLERK') return new Response(null, { status: 404 });
  return handler('GET', request);
});

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    if (getAuthProviderName() === 'CLERK') return new Response(null, { status: 404 });
    return handler('POST', request);
  }, AUTH_RATE_LIMIT),
);
