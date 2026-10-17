import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getSummary: vi.fn(),
}));

vi.mock('../../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../modules/customers/queries', () => ({
  getCustomerAccountsFromRequest: mocks.getSummary,
}));

import { GET } from './route';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('GET /api/customers/summary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
    mocks.getSummary.mockResolvedValue({ customers: [] });
  });

  it('authenticates before invoking the customer projection', async () => {
    mocks.authenticate.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );

    const response = await GET(
      new Request(`https://fuel.example.test/api/customers/summary?tenantId=${tenantId}`),
    );

    expect(response.status).toBe(401);
    expect(mocks.getSummary).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes only validated tenant/customer filters and returns a private no-store response', async () => {
    const customerId = '22222222-2222-4222-8222-222222222222';
    const response = await GET(
      new Request(
        `https://fuel.example.test/api/customers/summary?tenantId=${tenantId}&customerId=${customerId}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ customers: [] });
    expect(mocks.getSummary).toHaveBeenCalledWith(expect.any(Request), {
      tenantId,
      customerId,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
