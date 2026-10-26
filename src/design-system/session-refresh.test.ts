import { describe, expect, it, vi } from 'vitest';

import { fetchWithFreshSession } from './session-refresh';

const reply = (status: number) => new Response('{}', { status });
const clerkWith = () => {
  const getToken = vi.fn().mockResolvedValue('token');
  return { clerk: { session: { getToken } }, getToken };
};

describe('fetchWithFreshSession', () => {
  it('makes the token fresh before the command and sends it once when all is well', async () => {
    const { clerk, getToken } = clerkWith();
    const send = vi.fn().mockResolvedValue(reply(200));
    const response = await fetchWithFreshSession(
      send,
      '/api/x',
      { method: 'POST', body: '{}' },
      clerk,
    );
    expect(response.status).toBe(200);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith(undefined);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('forces a new token and sends the command again when the server says 401', async () => {
    const { clerk, getToken } = clerkWith();
    const send = vi.fn().mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200));
    const response = await fetchWithFreshSession(
      send,
      '/api/x',
      { method: 'POST', body: '{}' },
      clerk,
    );
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenLastCalledWith({ skipCache: true });
  });

  it('tries only once more, and returns the 401 if it persists', async () => {
    const { clerk } = clerkWith();
    const send = vi.fn().mockResolvedValue(reply(401));
    const response = await fetchWithFreshSession(
      send,
      '/api/x',
      { method: 'POST', body: '{}' },
      clerk,
    );
    expect(response.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not resend a body that cannot be read twice', async () => {
    const { clerk } = clerkWith();
    const send = vi.fn().mockResolvedValue(reply(401));
    const stream = new ReadableStream();
    const response = await fetchWithFreshSession(
      send,
      '/api/x',
      { method: 'POST', body: stream, duplex: 'half' } as RequestInit,
      clerk,
    );
    expect(response.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('still sends when Clerk is missing or its refresh fails', async () => {
    const send = vi.fn().mockResolvedValue(reply(200));
    expect(
      (await fetchWithFreshSession(send, '/api/x', { method: 'POST' }, undefined)).status,
    ).toBe(200);
    const failing = { session: { getToken: vi.fn().mockRejectedValue(new Error('offline')) } };
    expect((await fetchWithFreshSession(send, '/api/x', { method: 'POST' }, failing)).status).toBe(
      200,
    );
  });
});
