import { describe, expect, it } from 'vitest';
import { GET, POST } from './route';
describe('retired local MFA enrollment', () => {
  it.each([GET, POST])('returns an uncached 404', (handler) => {
    const response = handler();
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
