import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('Next security headers', () => {
  it('declares browser security headers for every route', async () => {
    const rules = await nextConfig.headers?.();
    const headers = rules?.[0]?.headers ?? [];
    const values = new Map(headers.map((header) => [header.key, header.value]));

    expect(values.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(values.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(values.get('X-Content-Type-Options')).toBe('nosniff');
    expect(values.get('X-Frame-Options')).toBe('DENY');
    expect(values.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(values.get('Permissions-Policy')).toContain('camera=()');
  });
});
