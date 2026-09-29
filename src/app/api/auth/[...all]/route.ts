import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '../../../../platform/auth';
import { withRequestObservability } from '../../../../platform/observability';

export const runtime = 'nodejs';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  return toNextJsHandler(getAuth()).GET(request);
});

export const POST = withRequestObservability(async (request: Request): Promise<Response> => {
  return toNextJsHandler(getAuth()).POST(request);
});
