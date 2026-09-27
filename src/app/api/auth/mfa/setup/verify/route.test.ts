import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  verifyTOTP: vi.fn(),
}));

vi.mock('../../../../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../../../platform/auth', () => ({
  getAuth: () => ({ api: { verifyTOTP: mocks.verifyTOTP } }),
}));

import { POST } from './route';

function request(body: unknown): Request {
  return new Request('https://fuel.example.test/api/auth/mfa/setup/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/mfa/setup/verify', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
    mocks.verifyTOTP.mockResolvedValue({ headers: new Headers(), response: { status: true } });
  });

  it('requires an authenticated session and verifies the enrollment code', async () => {
    const response = await POST(request({ code: '123456' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'enabled' });
    expect(mocks.verifyTOTP).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { code: '123456' },
      returnHeaders: true,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not expose provider details when the code is rejected', async () => {
    mocks.verifyTOTP.mockRejectedValue(new Error('secret=should-not-leak'));

    const response = await POST(request({ code: '000000' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'MFA_VERIFICATION_FAILED' });
  });

  it('does not parse an unauthenticated request body', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );
    const unauthenticated = request({ code: '123456' });
    const json = vi.spyOn(unauthenticated, 'json');

    const response = await POST(unauthenticated);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.verifyTOTP).not.toHaveBeenCalled();
  });
});
