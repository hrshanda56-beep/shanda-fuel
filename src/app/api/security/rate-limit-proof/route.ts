import { requireAuthenticatedActor } from '../../../../modules/identity';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import {
  STAGING_RATE_LIMIT_PROOF_POLICY,
  withPersistentRateLimit,
} from '../../../../platform/security';

const notAvailableOutsideStaging = (): Response =>
  new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });

const CANONICAL_VERCEL_PROJECT_ID = 'prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4';

function isStagingProofAvailable(): boolean {
  const projectId = process.env.VERCEL_PROJECT_ID;
  return (
    process.env.APP_ENV === 'staging' &&
    (projectId === undefined || projectId === CANONICAL_VERCEL_PROJECT_ID)
  );
}

const stagingProofHandler = withPersistentRateLimit(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error, {
      headers: { 'cache-control': 'no-store' },
    });
  }
}, STAGING_RATE_LIMIT_PROOF_POLICY);

/**
 * A staging-only, authenticated, non-mutating proof surface for the durable
 * HTTP rate limiter. It intentionally has no tenant or business-data inputs.
 * The limiter is inside observability but outside authentication, so denied
 * requests do not reach the authentication handler or any command parser.
 */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  if (!isStagingProofAvailable()) return notAvailableOutsideStaging();
  return stagingProofHandler(request);
});
