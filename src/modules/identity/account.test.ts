import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('./authenticated-actor', () => ({ requireAuthenticatedActor: mocks.actor }));
vi.mock('../../platform/db', () => ({ getDatabase: () => ({ transaction: mocks.transaction }) }));
import { readAuthenticatedAccount } from './account';
describe('authenticated account database boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actor.mockResolvedValue({ identityId: '11111111-1111-4111-8111-111111111111' });
    mocks.transaction.mockImplementation((work) => work({ execute: mocks.execute }));
  });
  it('sets transaction-local context before reading a username-only account', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'Owner', email: null }]);
    const result = await readAuthenticatedAccount(new Request('http://localhost/settings'));
    expect(result.user.email).toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const chunks = mocks.execute.mock.calls[0]![0].queryChunks;
    expect(JSON.stringify(chunks)).toContain('app.actor_id');
    expect(JSON.stringify(chunks)).toContain('app.tenant_id');
  });
  it('does not mistake a missing account for a signed-out session', async () => {
    mocks.execute.mockResolvedValue([]);
    await expect(
      readAuthenticatedAccount(new Request('http://localhost/settings')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('never opens the database for an unauthenticated request', async () => {
    mocks.actor.mockRejectedValue(new Error('unauthenticated'));
    await expect(
      readAuthenticatedAccount(new Request('http://localhost/settings')),
    ).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
