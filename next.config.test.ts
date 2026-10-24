import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function securityHeadersFor(nodeEnv: 'development' | 'production') {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  const { default: nextConfig } = await import('./next.config');
  const rules = await nextConfig.headers?.();
  return new Map((rules?.[0]?.headers ?? []).map((header) => [header.key, header.value]));
}

function expectRequiredHeaders(headers: Map<string, string>) {
  const csp = headers.get('Content-Security-Policy');
  expect(csp).toBeDefined();
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(headers.get('X-Frame-Options')).toBe('DENY');
  expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('Permissions-Policy')).toContain('camera=()');
}

describe('Next security headers', () => {
  it('keeps the required headers and allows eval only in development', async () => {
    const headers = await securityHeadersFor('development');
    const csp = headers.get('Content-Security-Policy');

    expectRequiredHeaders(headers);
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://*.protect.clerk.com 'unsafe-eval'",
    );
  });

  it('keeps eval out of production CSP while preserving the required headers', async () => {
    const headers = await securityHeadersFor('production');
    const csp = headers.get('Content-Security-Policy');

    expectRequiredHeaders(headers);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://*.protect.clerk.com;");
    expect(csp).toContain("worker-src 'self' blob:;");
    expect(csp).toContain("connect-src 'self' https://*.protect.clerk.com:*;");
    expect(csp).not.toContain("'unsafe-eval'");
    // The only outside hosts allowed anywhere in the policy are Clerk's bot-protection domain.
    const outside = (csp ?? '').match(/https:\/\/[^\s;]+/g) ?? [];
    expect(new Set(outside)).toEqual(
      new Set(['https://*.protect.clerk.com', 'https://*.protect.clerk.com:*']),
    );
  });
});
