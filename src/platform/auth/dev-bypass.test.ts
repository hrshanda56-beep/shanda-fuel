import { describe, expect, it } from 'vitest';

import { devBypassUsers, isLocalDevBypassEnabled, readDevBypassCookie } from './dev-bypass';

const local = {
  DEV_AUTH_BYPASS: '1',
  NODE_ENV: 'development',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:54331/db',
} as unknown as NodeJS.ProcessEnv;

describe('local dev bypass guard', () => {
  it('is on only when every local guard holds', () => {
    expect(isLocalDevBypassEnabled(local)).toBe(true);
  });

  it.each([
    ['flag missing', { DEV_AUTH_BYPASS: undefined }],
    ['production build', { NODE_ENV: 'production' }],
    ['staging', { APP_ENV: 'staging' }],
    ['production env', { APP_ENV: 'production' }],
    ['vercel', { VERCEL: '1' }],
    ['vercel env', { VERCEL_ENV: 'preview' }],
    ['ci', { CI: 'true' }],
    ['remote database', { DATABASE_URL: 'postgresql://u:p@ep-x.neon.tech/db' }],
    ['missing database url', { DATABASE_URL: undefined }],
    ['remote direct url', { DATABASE_DIRECT_URL: 'postgresql://u:p@db.neon.tech/db' }],
  ])('is off for %s', (_name, override) => {
    expect(isLocalDevBypassEnabled({ ...local, ...override } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('lists no users when disabled', () => {
    expect(
      devBypassUsers({ ...local, DEV_AUTH_BYPASS: '0', DEV_AUTH_BYPASS_USERS: 'A:user_1' }),
    ).toEqual([]);
  });

  it('parses labelled users', () => {
    expect(
      devBypassUsers({ ...local, DEV_AUTH_BYPASS_USERS: 'Local Owner:user_1, Bad, Fin:user_2' }),
    ).toEqual([
      { label: 'Local Owner', providerUserId: 'user_1' },
      { label: 'Fin', providerUserId: 'user_2' },
    ]);
  });

  it('reads the cookie', () => {
    expect(readDevBypassCookie('a=b; shanda_dev_user=user_1')).toBe('user_1');
    expect(readDevBypassCookie(null)).toBeNull();
  });
});
