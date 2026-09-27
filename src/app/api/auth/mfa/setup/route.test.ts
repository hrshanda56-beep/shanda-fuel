import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getSession: vi.fn(),
  enableTwoFactor: vi.fn(),
}));

vi.mock('../../../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../../platform/auth', () => ({
  getAuth: () => ({
    api: {
      getSession: mocks.getSession,
      enableTwoFactor: mocks.enableTwoFactor,
    },
  }),
}));

import { GET, POST } from './route';

function request(method: string, body?: unknown): Request {
  return new Request('https://fuel.example.test/api/auth/mfa/setup', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('/api/auth/mfa/setup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
  });

  it('reports the server-side enrollment state', async () => {
    mocks.getSession.mockResolvedValue({ user: { twoFactorEnabled: true } });

    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { disableCookieCache: true },
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('starts password-protected TOTP enrollment without exposing a secret to logs', async () => {
    mocks.enableTwoFactor.mockResolvedValue({
      method: 'totp',
      totpURI: 'otpauth://totp/Shanda%20Fuel:supervisor?secret=TESTSECRET',
      backupCodes: ['one-time-code'],
    });
    const input = request('POST', { password: 'correct-password' });

    const response = await POST(input);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'pending',
      method: 'totp',
      totpURI: 'otpauth://totp/Shanda%20Fuel:supervisor?secret=TESTSECRET',
      backupCodes: ['one-time-code'],
    });
    expect(mocks.enableTwoFactor).toHaveBeenCalledWith({
      headers: input.headers,
      body: { password: 'correct-password', method: 'totp', issuer: 'Shanda Fuel' },
    });
  });

  it('rejects malformed enrollment input before calling Better Auth', async () => {
    const response = await POST(request('POST', { password: '' }));

    expect(response.status).toBe(400);
    expect(mocks.enableTwoFactor).not.toHaveBeenCalled();
  });
});
