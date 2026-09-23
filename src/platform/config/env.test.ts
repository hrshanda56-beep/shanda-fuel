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

  it('requires complete R2 configuration once any R2 setting is supplied', () => {
    expect(() => getServerEnv({ APP_ENV: 'test', R2_ACCOUNT_ID: 'account' })).toThrow(
      'R2 storage configuration must be complete',
    );
  });

  it('requires a sender address when Resend is configured', () => {
    expect(() => getServerEnv({ APP_ENV: 'test', RESEND_API_KEY: 'configured' })).toThrow(
      'Required when Resend is configured',
    );
    expect(() =>
      getServerEnv({
        APP_ENV: 'test',
        RESEND_API_KEY: 'configured',
        RESEND_FROM_EMAIL: 'not-an-address',
      }),
    ).toThrow();
  });

  it('rejects an insecure production origin', () => {
    expect(() =>
      getServerEnv({
        APP_ENV: 'production',
        APP_URL: 'http://fuel.shandahr.com',
        DATABASE_URL: 'postgresql://configured',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
      }),
    ).toThrow('HTTPS');
  });

  it('requires the production authentication secret', () => {
    expect(() =>
      getServerEnv({
        APP_ENV: 'production',
        APP_URL: 'https://fuel.shandahr.com',
        DATABASE_URL: 'postgresql://configured',
      }),
    ).toThrow();
  });
});
