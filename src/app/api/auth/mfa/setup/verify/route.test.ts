import { describe, expect, it } from 'vitest';
import { POST } from './route';
describe('retired local MFA verification', () => {
  it('returns an uncached 404', () => {
    const response = POST();
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
