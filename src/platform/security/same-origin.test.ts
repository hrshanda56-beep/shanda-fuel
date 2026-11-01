import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCrossSiteWrite } from './same-origin';

const post = (headers: Record<string, string>, url = 'https://fuel.example.test/api/x') =>
  new Request(url, { method: 'POST', headers });

afterEach(() => vi.unstubAllEnvs());

describe('isCrossSiteWrite', () => {
  it('lets reads through whatever the origin', () => {
    const read = new Request('https://fuel.example.test/api/x', {
      headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' },
    });
    expect(isCrossSiteWrite(read)).toBe(false);
  });

  it('allows a same-origin write and a write with no Origin header', () => {
    expect(isCrossSiteWrite(post({ origin: 'https://fuel.example.test' }))).toBe(false);
    expect(isCrossSiteWrite(post({}))).toBe(false);
  });

  it('refuses a write from another site', () => {
    expect(isCrossSiteWrite(post({ origin: 'https://evil.test' }))).toBe(true);
    expect(isCrossSiteWrite(post({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });

  it('accepts the configured application URL and the forwarded host', () => {
    vi.stubEnv('APP_URL', 'https://fuel.shandahr.com');
    expect(
      isCrossSiteWrite(post({ origin: 'https://fuel.shandahr.com' }, 'http://internal:3000/api/x')),
    ).toBe(false);
    expect(
      isCrossSiteWrite(
        post(
          { origin: 'https://fuel.other.test', 'x-forwarded-host': 'fuel.other.test' },
          'http://internal:3000/api/x',
        ),
      ),
    ).toBe(false);
  });
});
