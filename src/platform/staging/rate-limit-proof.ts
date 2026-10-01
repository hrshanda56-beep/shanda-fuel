import { randomUUID } from 'node:crypto';

export const STAGING_RATE_LIMIT_PROOF_ROUTE = '/api/security/rate-limit-proof';
export const CANONICAL_STAGING_ORIGIN = 'https://shanda-fuel-staging.vercel.app';
export const STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT = 21;
export const STAGING_RATE_LIMIT_PROOF_WINDOW_SECONDS = 60;
export const STAGING_RATE_LIMIT_PROOF_TIMEOUT_MS = 10_000;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

export type StagingRateLimitProofArguments = {
  baseUrl: string;
};

export type StagingRateLimitProofEvidence = {
  schemaVersion: 'shanda-fuel.staging-rate-limit-proof.v1';
  environment: 'staging';
  route: typeof STAGING_RATE_LIMIT_PROOF_ROUTE;
  requestCount: number;
  requestIds: string[];
  responseStatuses: number[];
  elapsedMs: number[];
  observed429: boolean;
  pass: boolean;
};

type FetchImplementation = typeof fetch;
type Log = (message: string) => void;

function usage(): string {
  return [
    `Usage: APP_ENV=staging node --conditions=react-server --import tsx scripts/staging-rate-limit-proof.ts --confirm-staging-rate-limit-proof --base-url ${CANONICAL_STAGING_ORIGIN}`,
    '',
    `Sends exactly ${STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT} authenticated GET requests to the staging-only proof route.`,
    'The session cookie and optional Vercel bypass secret must be supplied through the process environment.',
  ].join('\n');
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function validateStagingOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('The staging --base-url must be a valid HTTPS origin.');
  }
  if (origin.protocol !== 'https:') {
    throw new Error('The staging --base-url must use HTTPS.');
  }
  if (origin.username || origin.password) {
    throw new Error('The staging --base-url must not contain username or password credentials.');
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('The staging --base-url must not include a path, query, or fragment.');
  }
  if (origin.origin !== CANONICAL_STAGING_ORIGIN) {
    throw new Error('The staging --base-url must be the canonical staging origin.');
  }
  return origin;
}

export function parseArguments(argv: string[]): StagingRateLimitProofArguments {
  const args = argv.slice(2);
  if (!args.includes('--confirm-staging-rate-limit-proof')) {
    throw new Error(
      'Pass --confirm-staging-rate-limit-proof to confirm a staging-only rate-limit proof.',
    );
  }
  if (
    args.includes('--session-cookie') ||
    args.includes('--cookie') ||
    args.includes('--vercel-automation-bypass-secret') ||
    args.includes('--bypass-secret')
  ) {
    throw new Error(
      'Cookies and bypass secrets must only be supplied through the process environment.',
    );
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-staging-rate-limit-proof') continue;
    if (arg === '--base-url') {
      index += 1;
      continue;
    }
    throw new Error('Unsupported command-line argument.');
  }

  const baseUrl = argumentValue(args, '--base-url');
  if (!baseUrl) throw new Error('A staging --base-url is required.');
  validateStagingOrigin(baseUrl);
  return { baseUrl };
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

function isApplicationRateLimitResponse(response: Response): boolean {
  if (response.status !== 429) return false;
  if (response.headers.get('x-ratelimit-limit') !== '20') return false;
  if (response.headers.get('x-ratelimit-remaining') !== '0') return false;

  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter || !POSITIVE_INTEGER_PATTERN.test(retryAfter)) return false;
  return Number(retryAfter) <= STAGING_RATE_LIMIT_PROOF_WINDOW_SECONDS;
}

async function discardResponseBody(response: Response | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // Response bodies are intentionally never exposed by the proof harness.
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  fetchImplementation: FetchImplementation,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STAGING_RATE_LIMIT_PROOF_TIMEOUT_MS);
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } catch {
    if (timedOut) throw new Error('A staging rate-limit proof request timed out.');
    throw new Error('A staging rate-limit proof request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function runStagingRateLimitProof(input: {
  baseUrl: string;
  sessionCookie: string;
  vercelAutomationBypassSecret?: string;
  fetchImplementation?: FetchImplementation;
  log?: Log;
}): Promise<StagingRateLimitProofEvidence> {
  const origin = validateStagingOrigin(input.baseUrl);
  if (!input.sessionCookie || CONTROL_CHARACTER_PATTERN.test(input.sessionCookie)) {
    throw new Error(
      'STAGING_RATE_LIMIT_PROOF_SESSION_COOKIE must be set without control characters.',
    );
  }
  if (
    input.vercelAutomationBypassSecret !== undefined &&
    CONTROL_CHARACTER_PATTERN.test(input.vercelAutomationBypassSecret)
  ) {
    throw new Error('The Vercel automation bypass secret contains invalid control characters.');
  }

  const endpoint = new URL(STAGING_RATE_LIMIT_PROOF_ROUTE, origin);
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const log = input.log ?? console.log;
  const requestIds: string[] = [];
  const responseStatuses: number[] = [];
  const elapsedMs: number[] = [];
  let observed429 = false;

  for (let index = 0; index < STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT; index += 1) {
    const requestId = randomUUID();
    requestIds.push(requestId);
    let response: Response | undefined;
    const startedAt = performance.now();
    try {
      const headers = new Headers({
        accept: 'application/json',
        cookie: input.sessionCookie,
        'x-request-id': requestId,
      });
      if (input.vercelAutomationBypassSecret) {
        headers.set('x-vercel-protection-bypass', input.vercelAutomationBypassSecret);
      }
      response = await fetchWithTimeout(
        endpoint,
        { method: 'GET', headers, redirect: 'manual' },
        fetchImplementation,
      );
      const elapsed = elapsedMilliseconds(startedAt);
      elapsedMs.push(elapsed);
      if (response.redirected || (response.status >= 300 && response.status <= 399)) {
        throw new Error('The staging rate-limit proof refused an HTTP redirect.');
      }

      const expectedStatus = index < STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT - 1 ? 204 : 429;
      if (response.status !== expectedStatus) {
        throw new Error(
          `Unexpected HTTP status in staging rate-limit proof at request ${index + 1}.`,
        );
      }
      if (response.status === 429) {
        if (!isApplicationRateLimitResponse(response)) {
          throw new Error(`Unexpected application rate-limit response at request ${index + 1}.`);
        }
        observed429 = true;
      }
      responseStatuses.push(response.status);
      log(
        `rate-limit proof request ${index + 1}/${STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT}: ${requestId} HTTP ${response.status} ${elapsed}ms`,
      );
    } finally {
      await discardResponseBody(response);
    }
  }

  return {
    schemaVersion: 'shanda-fuel.staging-rate-limit-proof.v1',
    environment: 'staging',
    route: STAGING_RATE_LIMIT_PROOF_ROUTE,
    requestCount: STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT,
    requestIds,
    responseStatuses,
    elapsedMs,
    observed429,
    pass: observed429,
  };
}

export function proofUsage(): string {
  return usage();
}
