import { createFrontendApiProxyHandlers } from '@clerk/nextjs/server';

import { reportClerkEnvProblems } from '@/platform/auth/clerk-env';

const proxy = createFrontendApiProxyHandlers({
  proxyPath: '/api/clerk',
});

type Handler = (request: Request) => Promise<Response> | Response;

/**
 * Before forwarding to Clerk, check that the two keys are a matching pair. If they are not, say so
 * plainly (and once in the server log) instead of passing on Clerk's own "secret key is invalid".
 */
function checked(handler: Handler): Handler {
  return (request) => {
    const problems = reportClerkEnvProblems();
    if (problems.length > 0) {
      return Response.json(
        {
          error: 'CLERK_NOT_CONFIGURED',
          message: `Sign-in is not set up correctly on this server. ${problems[0]}`,
        },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    return handler(request);
  };
}

export const GET = checked(proxy.GET as Handler);
export const POST = checked(proxy.POST as Handler);
export const PUT = checked(proxy.PUT as Handler);
export const DELETE = checked(proxy.DELETE as Handler);
export const PATCH = checked(proxy.PATCH as Handler);
