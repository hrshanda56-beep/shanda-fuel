import { afterEach, describe, expect, it, vi } from 'vitest';

const clerkClientMock = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: clerkClientMock,
  getAuth: vi.fn(),
}));

import { revokeClerkUserSessions } from './provider';

afterEach(() => {
  vi.clearAllMocks();
});

function clientWithSessions(
  sessions: { id: string }[],
  revokeSession: (id: string) => Promise<void>,
) {
  const getSessionList = vi.fn().mockResolvedValue({ data: sessions });
  clerkClientMock.mockResolvedValue({
    sessions: { getSessionList, revokeSession: vi.fn(revokeSession) },
  });
  return { getSessionList };
}

describe('Clerk session revocation result', () => {
  it('reports a successful no-active-session check', async () => {
    clientWithSessions([], async () => undefined);

    await expect(revokeClerkUserSessions('user_redacted')).resolves.toEqual({
      activeSessionsFound: 0,
      sessionsRevoked: 0,
      complete: true,
    });
  });

  it('reports complete revocation without exposing provider session ids', async () => {
    clientWithSessions([{ id: 'session_redacted' }], async () => undefined);
    await expect(revokeClerkUserSessions('user_redacted')).resolves.toEqual({
      activeSessionsFound: 1,
      sessionsRevoked: 1,
      complete: true,
    });
  });

  it('reports partial completion when one provider revocation fails', async () => {
    clientWithSessions([{ id: 'session_a' }, { id: 'session_b' }], async (id) => {
      if (id === 'session_b') throw new Error('provider failure');
    });

    await expect(revokeClerkUserSessions('user_redacted')).resolves.toEqual({
      activeSessionsFound: 2,
      sessionsRevoked: 1,
      complete: false,
    });
  });

  it('propagates an active-session lookup failure to the caller', async () => {
    const getSessionList = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    clerkClientMock.mockResolvedValue({
      sessions: { getSessionList, revokeSession: vi.fn() },
    });

    await expect(revokeClerkUserSessions('user_redacted')).rejects.toThrow('provider unavailable');
  });
});
