import 'server-only';

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../db';
import { createLogger } from '../logging';

const logger = createLogger({ component: 'rate-limit' });

export type RateLimitPolicy = Readonly<{
  scope: 'auth' | 'write' | 'proof';
  limit: number;
  windowSeconds: number;
}>;

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}>;

export const AUTH_RATE_LIMIT: RateLimitPolicy = {
  scope: 'auth',
  limit: 20,
  windowSeconds: 60,
};

export const WRITE_RATE_LIMIT: RateLimitPolicy = {
  scope: 'write',
  limit: 120,
  windowSeconds: 60,
};

export const STAGING_RATE_LIMIT_PROOF_POLICY: RateLimitPolicy = {
  scope: 'proof',
  limit: 20,
  windowSeconds: 60,
};

function isDeployedEnvironment(): boolean {
  return process.env.APP_ENV === 'staging' || process.env.APP_ENV === 'production';
}

function firstForwardedAddress(value: string | null): string | undefined {
  const candidate = value
    ?.split(',')
    .map((item) => item.trim())
    .find((item) => item.length > 0 && item.length <= 128);
  return candidate;
}

/**
 * The deployment edge must normalize one of these headers before the request
 * reaches Node. The provider checklist records that external prerequisite;
 * this code never trusts arbitrary request bodies or cookies for the identity.
 */
export function getRateLimitClientAddress(request: Request): string {
  return (
    firstForwardedAddress(request.headers.get('x-forwarded-for')) ??
    firstForwardedAddress(request.headers.get('x-vercel-forwarded-for')) ??
    firstForwardedAddress(request.headers.get('x-real-ip')) ??
    firstForwardedAddress(request.headers.get('cf-connecting-ip')) ??
    'unknown-client'
  );
}

export function hashRateLimitKey(scope: RateLimitPolicy['scope'], clientAddress: string): string {
  return createHash('sha256').update(`${scope}\u0000${clientAddress}`).digest('hex');
}

export function rateLimitResponse(decision: RateLimitDecision): Response {
  return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), {
    status: 429,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'retry-after': String(decision.retryAfterSeconds),
      'x-ratelimit-limit': String(decision.limit),
      'x-ratelimit-remaining': String(decision.remaining),
    },
  });
}

export async function consumePersistentRateLimit(
  request: Request,
  policy: RateLimitPolicy,
): Promise<RateLimitDecision> {
  const keyHash = hashRateLimitKey(policy.scope, getRateLimitClientAddress(request));
  const rows = (await getDatabase().execute(sql`
    select
      allowed,
      remaining,
      retry_after_seconds as "retryAfterSeconds"
    from platform.consume_rate_limit(
      ${policy.scope},
      ${keyHash},
      ${policy.limit},
      ${policy.windowSeconds}
    )
  `)) as unknown as Array<{
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  }>;

  const decision = rows[0];
  if (!decision) throw new Error('rate limit function returned no decision');
  return {
    allowed: decision.allowed,
    remaining: Number(decision.remaining),
    retryAfterSeconds: Number(decision.retryAfterSeconds),
    limit: policy.limit,
  };
}

export function withPersistentRateLimit(
  handler: (request: Request) => Response | Promise<Response>,
  policy: RateLimitPolicy,
): (request: Request) => Promise<Response> {
  return async (request) => {
    // Local and unit-test paths have no deployed provider edge or durable
    // database. Staging and production fail closed at the database boundary.
    if (!isDeployedEnvironment()) return handler(request);

    try {
      const decision = await consumePersistentRateLimit(request, policy);
      if (!decision.allowed) return rateLimitResponse(decision);
      return handler(request);
    } catch (error) {
      logger.error('security.rate_limit.unavailable', {
        environment: process.env.APP_ENV,
        method: request.method,
        route: new URL(request.url).pathname,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
      return new Response(JSON.stringify({ error: 'DEPENDENCY_UNAVAILABLE' }), {
        status: 503,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
          'retry-after': '30',
        },
      });
    }
  };
}
