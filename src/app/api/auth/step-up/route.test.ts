import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveContext: vi.fn(),
  establish: vi.fn(),
}));

vi.mock('../../../../modules/identity', () => ({
  establishStepUp: mocks.establish,
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../modules/tenancy/authority', () => ({
  resolveTenantExecutionContext: mocks.resolveContext,
}));

import { POST } from './route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const context = { membership: { tenantId } };

function request(body: unknown): Request {
  return new Request('https://fuel.example.test/api/auth/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/step-up', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
    mocks.resolveContext.mockResolvedValue(context);
    mocks.establish.mockResolvedValue({
      level: 1,
      tenantId,
      expiresAt: '2026-09-27T10:10:00.000Z',
    });
  });

  it('authenticates before parsing and establishes the current tenant step-up', async () => {
    const response = await POST(request({ tenantId, password: 'correct', totpCode: '123456' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'active',
      stepUpLevel: 1,
      expiresAt: '2026-09-27T10:10:00.000Z',
    });
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.objectContaining({ requestedTenantId: tenantId }),
    );
    expect(mocks.establish).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'correct', totpCode: '123456', context }),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a generic forbidden response for a failed challenge', async () => {
    mocks.establish.mockRejectedValueOnce(new AppError('FORBIDDEN', 'Step-up verification failed'));

    const response = await POST(request({ tenantId, password: 'wrong', totpCode: '000000' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'FORBIDDEN',
      message: 'Step-up verification failed',
    });
  });

  it('does not parse an unauthenticated request body', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );
    const unauthenticated = request({ tenantId, password: 'correct', totpCode: '123456' });
    const json = vi.spyOn(unauthenticated, 'json');

    const response = await POST(unauthenticated);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.resolveContext).not.toHaveBeenCalled();
  });

  it('rejects a password-only request before provider verification', async () => {
    const response = await POST(request({ tenantId, password: 'correct' }));

    expect(response.status).toBe(400);
    expect(mocks.resolveContext).not.toHaveBeenCalled();
    expect(mocks.establish).not.toHaveBeenCalled();
  });
});
