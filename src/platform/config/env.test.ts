import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuditSigningKey, getServerEnv as parseServerEnv } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

function getServerEnv(input: Record<string, unknown> = {}) {
  return parseServerEnv({ AUTH_PROVIDER: 'BETTER_AUTH', ...input });
}

describe('server environment validation', () => {
  it('accepts local development without production credentials', () => {
    expect(
      getServerEnv({
        APP_ENV: 'local',
        APP_URL: 'http://localhost:3000',
        AUTH_PROVIDER: 'BETTER_AUTH',
      }),
    ).toMatchObject({
      APP_ENV: 'local',
      APP_URL: 'http://localhost:3000',
      AUTH_PROVIDER: 'BETTER_AUTH',
      REQUIRE_LOGIN_MFA: true,
      REQUIRE_PRIVILEGED_STEP_UP: true,
    });
  });

  it('supports an explicit login-MFA override without permitting privileged-step-up weakening', () => {
    expect(
      getServerEnv({
        APP_ENV: 'test',
        REQUIRE_LOGIN_MFA: 'false',
        REQUIRE_PRIVILEGED_STEP_UP: 'true',
      }),
    ).toMatchObject({ REQUIRE_LOGIN_MFA: false, REQUIRE_PRIVILEGED_STEP_UP: true });
    expect(() => getServerEnv({ APP_ENV: 'test', REQUIRE_PRIVILEGED_STEP_UP: 'false' })).toThrow(
      'Privileged step-up must remain enabled',
    );
    expect(() => getServerEnv({ APP_ENV: 'test', REQUIRE_LOGIN_MFA: 'not-a-boolean' })).toThrow();
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
    APP_URL: 'https://staging.shandahr.com',
    AUTH_PROVIDER: 'BETTER_AUTH',
    DATABASE_URL: 'postgresql://staging-runtime',
    BETTER_AUTH_SECRET: 'b'.repeat(32),
    AUDIT_SIGNING_KEY_ID: 'staging-audit-v1',
    AUDIT_SIGNING_KEY: 's'.repeat(32),
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
        AUTH_PROVIDER: 'BETTER_AUTH',
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
        AUTH_PROVIDER: 'BETTER_AUTH',
        DATABASE_URL: 'postgresql://configured',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
      }),
    ).toThrow('HTTPS');
  });

  it('requires deployed staging configuration and does not accept a loopback origin', () => {
    expect(() =>
      getServerEnv({
        APP_ENV: 'staging',
        APP_URL: 'https://staging.shandahr.com',
      }),
    ).toThrow('Required in staging and production');
    expect(() =>
      getServerEnv({
        APP_ENV: 'staging',
        APP_URL: 'https://localhost:3000',
        AUTH_PROVIDER: 'BETTER_AUTH',
        DATABASE_URL: 'postgresql://configured',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        AUDIT_SIGNING_KEY_ID: 'staging-audit-v1',
        AUDIT_SIGNING_KEY: 's'.repeat(32),
      }),
    ).toThrow('Loopback APP_URL');
  });

  it('rejects migration-only direct database credentials in deployed app runtime', () => {
    expect(() =>
      getServerEnv({
        APP_ENV: 'production',
        APP_URL: 'https://fuel.shandahr.com',
        AUTH_PROVIDER: 'BETTER_AUTH',
        DATABASE_URL: 'postgresql://configured',
        DATABASE_DIRECT_URL: 'postgresql://migration-owner',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        AUDIT_SIGNING_KEY_ID: 'production-audit-v1',
        AUDIT_SIGNING_KEY: 's'.repeat(32),
      }),
    ).toThrow('DATABASE_DIRECT_URL');
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

  it('does not require Better Auth credentials when deployed Clerk is selected', () => {
    expect(
      getServerEnv({
        APP_ENV: 'staging',
        APP_URL: 'https://staging.shandahr.com',
        AUTH_PROVIDER: 'CLERK',
        DATABASE_URL: 'postgresql://configured',
        CLERK_SECRET_KEY: 'sk_fake_clerk_fixture',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_fake_clerk_fixture',
        AUDIT_SIGNING_KEY_ID: 'staging-audit-v1',
        AUDIT_SIGNING_KEY: 's'.repeat(32),
      }),
    ).toMatchObject({ AUTH_PROVIDER: 'CLERK' });
  });

  it('requires audit signing credentials in production', () => {
    const base = {
      APP_ENV: 'production',
      APP_URL: 'https://fuel.shandahr.com',
      AUTH_PROVIDER: 'BETTER_AUTH',
      DATABASE_URL: 'postgresql://configured',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
    };
    expect(() => getServerEnv(base)).toThrow(/AUDIT_SIGNING_KEY_ID|AUDIT_SIGNING_KEY/);
    expect(() =>
      getServerEnv({
        ...base,
        AUDIT_SIGNING_KEY_ID: 'audit-v1',
        AUDIT_SIGNING_KEY: 'short',
      }),
    ).toThrow('at least 32 characters');
    expect(
      getAuditSigningKey({
        ...base,
        AUDIT_SIGNING_KEY_ID: 'audit-v1',
        AUDIT_SIGNING_KEY: 's'.repeat(32),
      }),
    ).toEqual({ keyId: 'audit-v1', secret: 's'.repeat(32) });
  });

  it('requires APP_ENV to be explicit in a production Node runtime while allowing staging', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getServerEnv({ APP_URL: 'https://fuel.shandahr.com' })).toThrow(
      'APP_ENV must be explicitly configured',
    );
    expect(
      getServerEnv({
        APP_ENV: 'staging',
        APP_URL: 'https://staging.shandahr.com',
        AUTH_PROVIDER: 'BETTER_AUTH',
        DATABASE_URL: 'postgresql://staging-runtime',
        BETTER_AUTH_SECRET: 'b'.repeat(32),
        AUDIT_SIGNING_KEY_ID: 'staging-audit-v1',
        AUDIT_SIGNING_KEY: 's'.repeat(32),
      }).APP_ENV,
    ).toBe('staging');
  });
});
