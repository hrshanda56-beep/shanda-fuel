import { describe, expect, it, vi } from 'vitest';
import {
  fetchWithTimeout,
  parseArguments,
  runStagingAlertProof,
  validateStagingOrigin,
} from '../../../scripts/staging-observability-alert-proof';

function response(status: number, cancel = vi.fn()): Response {
  return { body: { cancel }, redirected: false, status } as unknown as Response;
}

describe('staging observability alert proof harness', () => {
  it('accepts only an HTTPS origin and rejects credentials, paths, queries, and fragments', () => {
    expect(validateStagingOrigin('https://staging.example.test/').origin).toBe(
      'https://staging.example.test',
    );

    for (const value of [
      'http://staging.example.test/',
      'https://user:password@staging.example.test/',
      'https://staging.example.test/app/',
      'https://staging.example.test/?token=secret',
      'https://staging.example.test/#fragment',
    ]) {
      expect(() => validateStagingOrigin(value)).toThrow();
    }
  });

  it('requires explicit staging confirmation and never accepts a bypass secret argument', () => {
    expect(() =>
      parseArguments(['node', 'proof', '--base-url', 'https://staging.example.test/']),
    ).toThrow('confirm-staging-alert-proof');

    const secret = 'never-reflect-this-secret';
    let error: unknown;
    try {
      parseArguments([
        'node',
        'proof',
        '--confirm-staging-alert-proof',
        '--base-url',
        'https://staging.example.test/',
        '--bypass-secret',
        secret,
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(() =>
      parseArguments([
        'node',
        'proof',
        '--confirm-staging-alert-proof',
        '--base-url',
        'https://staging.example.test/',
        secret,
      ]),
    ).toThrow('Unsupported command-line argument');
  });

  it('uses GET with manual redirects, rejects redirects, and cancels the response body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    let requestInit: RequestInit | undefined;
    const fetchImplementation = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init;
      return response(302, cancel);
    }) as typeof fetch;

    await expect(
      runStagingAlertProof({
        baseUrl: 'https://staging.example.test/',
        count: 1,
        fetchImplementation,
        log: vi.fn(),
      }),
    ).rejects.toThrow('refused an HTTP redirect');
    expect(requestInit).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('aborts a request after the bounded timeout', async () => {
    const fetchImplementation = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      })) as typeof fetch;

    await expect(
      fetchWithTimeout('https://staging.example.test/', {}, fetchImplementation, 5),
    ).rejects.toThrow('timed out after 5ms');
  });

  it('uses an environment-only Vercel bypass header without exposing it in output or evidence', async () => {
    const secret = 'never-print-this-vercel-secret';
    const cancel = vi.fn().mockResolvedValue(undefined);
    let requestHeaders: Headers | undefined;
    const logs: string[] = [];
    const fetchImplementation = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return response(401, cancel);
    }) as typeof fetch;

    const result = await runStagingAlertProof({
      baseUrl: 'https://staging.example.test/',
      count: 1,
      environment: { APP_ENV: 'staging', VERCEL_AUTOMATION_BYPASS_SECRET: secret },
      fetchImplementation,
      log: (message) => logs.push(message),
    });

    expect(requestHeaders?.get('x-vercel-protection-bypass')).toBe(secret);
    expect(logs.join('\n')).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
