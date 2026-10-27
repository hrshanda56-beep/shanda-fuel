import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  preview: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  lock: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
}));

vi.mock('../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../modules/opening-balances/commands', () => ({
  previewOpeningBalanceImportFromRequest: mocks.preview,
  createOpeningBalanceBatchFromRequest: mocks.create,
  approveOpeningBalanceBatchFromRequest: mocks.approve,
  lockOpeningBalanceBatchFromRequest: mocks.lock,
}));

vi.mock('../../../modules/opening-balances/queries', () => ({
  listOpeningBalanceBatchesFromRequest: mocks.list,
  getOpeningBalanceBatchFromRequest: mocks.detail,
}));

import { GET, POST } from './route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://fuel.example.test/api/opening-balances', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('opening balance API boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ identityId: 'actor' });
    mocks.preview.mockResolvedValue({ valid: true, rowCount: 1 });
    mocks.create.mockResolvedValue({ batchId, state: 'DRAFT' });
    mocks.approve.mockResolvedValue({ batchId, state: 'APPROVED' });
    mocks.lock.mockResolvedValue({ batchId, state: 'LOCKED' });
    mocks.list.mockResolvedValue({ batches: [] });
    mocks.detail.mockResolvedValue(null);
  });

  it('authenticates before parsing an unauthenticated body', async () => {
    mocks.authenticate.mockRejectedValue(new AppError('UNAUTHENTICATED', 'Sign in required'));
    const request = new Request('https://fuel.example.test/api/opening-balances', {
      method: 'POST',
      body: '{',
    });
    const json = vi.spyOn(request, 'json');

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('dispatches CSV requests to preview without mutating', async () => {
    const csv = 'line_key,line_type\n';
    const response = await POST(
      new Request(`https://fuel.example.test/api/opening-balances?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: csv,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ commandType: 'PreviewOpeningBalanceImport', tenantId, csv }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('dispatches approval and lock commands and preserves no-store responses', async () => {
    const approved = await POST(
      jsonRequest(
        { commandType: 'ApproveOpeningBalanceBatch', tenantId, batchId, expectedVersion: 0 },
        {
          'idempotency-key': 'approve-1',
        },
      ),
    );
    const locked = await POST(
      jsonRequest(
        { commandType: 'LockOpeningBalanceBatch', tenantId, batchId, expectedVersion: 1 },
        {
          'idempotency-key': 'lock-1',
        },
      ),
    );

    expect(approved.status).toBe(200);
    expect(locked.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(locked.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns validation for an unsupported command without dispatching a handler', async () => {
    const response = await POST(jsonRequest({ commandType: 'NotACommand', tenantId }));

    expect(response.status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it('lists and loads batches through authenticated reads', async () => {
    const listResponse = await GET(
      new Request(`https://fuel.example.test/api/opening-balances?tenantId=${tenantId}`),
    );
    const detailResponse = await GET(
      new Request(
        `https://fuel.example.test/api/opening-balances?tenantId=${tenantId}&batchId=${batchId}`,
      ),
    );

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.detail).toHaveBeenCalledOnce();
  });
});
