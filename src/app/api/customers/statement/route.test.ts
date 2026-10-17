import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getStatement: vi.fn(),
}));

vi.mock('../../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../modules/customers/queries', () => ({
  getCustomerAccountStatementFromRequest: mocks.getStatement,
}));

import { GET } from './route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const accountId = '33333333-3333-4333-8333-333333333333';

describe('GET /api/customers/statement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
    mocks.getStatement.mockResolvedValue({
      accountId,
      balance: { accountType: 'CREDIT', currency: 'USD', amount: '5.1250' },
      lines: [],
      asOf: '2026-10-17T04:00:00.000Z',
      nextCursor: 'entry-2',
    });
  });

  it('authenticates before invoking the statement projection', async () => {
    mocks.authenticate.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );

    const response = await GET(
      new Request(
        `https://fuel.example.test/api/customers/statement?tenantId=${tenantId}&accountId=${accountId}`,
      ),
    );

    expect(response.status).toBe(401);
    expect(mocks.getStatement).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes validated as-of and cursor filters and keeps the response private', async () => {
    const response = await GET(
      new Request(
        `https://fuel.example.test/api/customers/statement?tenantId=${tenantId}&accountId=${accountId}&asOf=2026-10-17T04%3A00%3A00.000Z&limit=25&cursor=entry-1`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountId, nextCursor: 'entry-2' });
    expect(mocks.getStatement).toHaveBeenCalledWith(expect.any(Request), {
      tenantId,
      accountId,
      asOf: '2026-10-17T04:00:00.000Z',
      limit: 25,
      cursor: 'entry-1',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
