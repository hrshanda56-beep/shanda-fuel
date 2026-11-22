import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useReverification: (fn: unknown) => fn }));

import { lockClosedDays } from './lock-days';

const scope = { tenantId: 't', stationId: 's' };

describe('lockClosedDays', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('locks each day with the normal lock command and reports the ones that refuse', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'This day cannot be locked yet.' }),
      })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const outcomes = await lockClosedDays(scope, [
      { id: 'a', version: 3 },
      { id: 'b', version: 4 },
      { id: 'c', version: 5 },
    ]);
    expect(outcomes).toEqual([
      { id: 'a', locked: true },
      { id: 'b', locked: false, message: 'This day cannot be locked yet.' },
      { id: 'c', locked: false, message: 'The connection failed.' },
    ]);
    const first = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(first).toMatchObject({
      commandType: 'LockBusinessDay',
      businessDayId: 'a',
      expectedVersion: 3,
    });
  });
});
