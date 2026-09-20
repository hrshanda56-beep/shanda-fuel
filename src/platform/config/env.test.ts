import { describe, expect, it } from 'vitest';
import { getServerEnv } from './env';

describe('server environment validation', () => {
  it('accepts local development without production credentials', () => {
    expect(getServerEnv({ APP_ENV: 'local', APP_URL: 'http://localhost:3000' })).toMatchObject({
      APP_ENV: 'local',
      APP_URL: 'http://localhost:3000',
    });
  });

  it('requires a database in production', () => {
    expect(() =>
      getServerEnv({ APP_ENV: 'production', APP_URL: 'https://fuel.shandahr.com' }),
    ).toThrow();
  });

  it('rejects malformed URLs', () => {
    expect(() => getServerEnv({ APP_ENV: 'local', APP_URL: 'not-a-url' })).toThrow();
  });
});
