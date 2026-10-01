import { describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_STAGING_ORIGIN,
  parseArguments,
  runStagingRateLimitProof,
  STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT,
  STAGING_RATE_LIMIT_PROOF_WINDOW_SECONDS,
  validateStagingOrigin,
} from './rate-limit-proof';

const baseUrl = CANONICAL_STAGING_ORIGIN;

function response(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers });
}

function validLimiterResponse(): Response {
  return response(429, {
    'x-ratelimit-limit': '20',
    'x-ratelimit-remaining': '0',
    'retry-after': String(STAGING_RATE_LIMIT_PROOF_WINDOW_SECONDS),
  });
}

async function runWithFinalResponse(finalResponse: Response) {
  const responses: Response[] = [...Array(20).fill(response(204)), finalResponse];
  const fetcher = vi.fn(async () => responses.shift() ?? response(500));
  const log = vi.fn();
  const evidence = await runStagingRateLimitProof({
    baseUrl,
    sessionCookie: 'shanda-fuel.session_token=opaque',
    vercelAutomationBypassSecret: 'bypass-secret',
    fetchImplementation: fetcher,
    log,
  });
  return { evidence, fetcher, log };
}

describe('staging rate-limit proof safety', () => {
  it('accepts only the exact canonical staging alias', () => {
    expect(validateStagingOrigin(CANONICAL_STAGING_ORIGIN).origin).toBe(CANONICAL_STAGING_ORIGIN);
    expect(validateStagingOrigin(`${CANONICAL_STAGING_ORIGIN}/`).origin).toBe(
      CANONICAL_STAGING_ORIGIN,
    );
  });

  it('requires explicit confirmation and rejects every other origin shape', () => {
    expect(() => parseArguments(['node', 'proof', '--base-url', baseUrl])).toThrow(
      'confirm-staging-rate-limit-proof',
    );
    for (const invalidOrigin of [
      'https://shanda-fuel-staging-git-feature.vercel.app',
      'https://staging.example.test',
      'https://fuel.shandahr.com',
      'http://shanda-fuel-staging.vercel.app',
      'https://user:password@shanda-fuel-staging.vercel.app',
      'https://shanda-fuel-staging.vercel.app/app',
      'https://shanda-fuel-staging.vercel.app?query=1',
      'https://shanda-fuel-staging.vercel.app#fragment',
    ]) {
      expect(() => validateStagingOrigin(invalidOrigin)).toThrow();
    }
  });

  it('rejects credential arguments and keeps the request count fixed', () => {
    expect(() =>
      parseArguments([
        'node',
        'proof',
        '--confirm-staging-rate-limit-proof',
        '--base-url',
        baseUrl,
        '--session-cookie',
        'secret',
      ]),
    ).toThrow('process environment');
    expect(STAGING_RATE_LIMIT_PROOF_REQUEST_COUNT).toBe(21);
  });

  it('accepts 20x204 followed by the application limiter 429 headers', async () => {
    const calls: Array<{ method?: string; cookie?: string; body?: BodyInit | null }> = [];
    const statuses = [...Array(20).fill(204), 429];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method,
        cookie: new Headers(init?.headers).get('cookie') ?? undefined,
        body: init?.body,
      });
      return calls.length === 21
        ? validLimiterResponse()
        : response(statuses[calls.length - 1] ?? 500);
    });
    const log = vi.fn();

    const evidence = await runStagingRateLimitProof({
      baseUrl,
      sessionCookie: 'shanda-fuel.session_token=opaque',
      vercelAutomationBypassSecret: 'bypass-secret',
      fetchImplementation: fetcher,
      log,
    });

    expect(fetcher).toHaveBeenCalledTimes(21);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.cookie === 'shanda-fuel.session_token=opaque')).toBe(true);
    expect(calls.every((call) => call.body === undefined)).toBe(true);
    expect(evidence.responseStatuses).toEqual(statuses);
    expect(evidence.observed429).toBe(true);
    expect(evidence.pass).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('opaque');
    expect(JSON.stringify(evidence)).not.toContain('bypass-secret');
    expect(log.mock.calls.flat().join('\n')).not.toContain('opaque');
    expect(log.mock.calls.flat().join('\n')).not.toContain('bypass-secret');
  });

  it('rejects a generic 429 without application limiter headers', async () => {
    await expect(runWithFinalResponse(response(429))).rejects.toThrow(
      'Unexpected application rate-limit response',
    );
  });

  it.each([
    ['wrong limit', { 'x-ratelimit-limit': '19' }],
    ['wrong remaining', { 'x-ratelimit-remaining': '1' }],
    ['zero retry-after', { 'retry-after': '0' }],
    ['invalid retry-after', { 'retry-after': 'not-an-integer' }],
    ['out-of-range retry-after', { 'retry-after': '61' }],
  ])('rejects a 429 with %s', async (_label, invalidHeader) => {
    const headers = new Headers(validLimiterResponse().headers);
    for (const [name, value] of Object.entries(invalidHeader)) headers.set(name, value);

    await expect(runWithFinalResponse(response(429, headers))).rejects.toThrow(
      'Unexpected application rate-limit response',
    );
  });

  it('stops immediately on an unexpected result', async () => {
    const fetcher = vi.fn(async () => response(500));

    await expect(
      runStagingRateLimitProof({
        baseUrl,
        sessionCookie: 'opaque',
        fetchImplementation: fetcher,
      }),
    ).rejects.toThrow('Unexpected HTTP status');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
