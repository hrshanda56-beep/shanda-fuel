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

  const validR2 = {
    APP_ENV: 'staging',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_BUCKET: 'shanda-staging-private',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
  };

  it.each([
    'attacker.example#',
    'attacker.example/',
    'attacker.example?',
    'attacker.example@',
    'attacker.example:',
    'attacker.example',
    '0123456789abcdef0123456789abcde',
    '0123456789abcdef0123456789abcdef0',
    '0123456789abcdef0123456789abcde ',
    '',
  ])('rejects malformed R2 account ID %j', (R2_ACCOUNT_ID) => {
    expect(() => getServerEnv({ ...validR2, R2_ACCOUNT_ID })).toThrow(
      'R2 account ID must be 32 hexadecimal characters',
    );
  });

  it.each([
    'bad_bucket',
    'Uppercase',
    'ab',
    '-starts-with-hyphen',
    'ends-with-hyphen-',
    `${'a'.repeat(64)}`,
  ])('rejects invalid R2 bucket name %j', (R2_BUCKET) => {
    expect(() => getServerEnv({ ...validR2, R2_BUCKET })).toThrow('R2 bucket name is invalid');
  });

  it('accepts Cloudflare-formatted staging account and bucket settings', () => {
    expect(getServerEnv(validR2)).toMatchObject({
      R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_BUCKET: 'shanda-staging-private',
    });
  });

  it('requires complete, separate recovery configuration when any recovery setting is supplied', () => {
    expect(() =>
      getServerEnv({ ...validR2, R2_RECOVERY_BUCKET: 'shanda-staging-recovery' }),
    ).toThrow('R2 recovery storage configuration must be complete');
    expect(() =>
      getServerEnv({
        ...validR2,
        R2_RECOVERY_BUCKET: validR2.R2_BUCKET,
        R2_RECOVERY_ACCESS_KEY_ID: 'recovery-access-key',
        R2_RECOVERY_SECRET_ACCESS_KEY: 'recovery-secret-key',
      }),
    ).toThrow('R2 recovery bucket must differ');
  });

  it('requires recovery configuration when private storage is configured in production', () => {
    expect(() =>
      getServerEnv({
        ...validR2,
        APP_ENV: 'production',
        APP_URL: 'https://fuel.shandahr.com',
        DATABASE_URL: 'postgresql://configured',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
      }),
    ).toThrow('R2 recovery storage is required');
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
