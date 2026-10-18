import { expect, it, vi } from 'vitest';
import { preparedDrizzleClient } from './prepared-client';
it('prepares Drizzle unsafe calls without changing SQL/parameters or mutating the client', () => {
  const unsafe = vi.fn();
  const raw = { unsafe };
  const client = preparedDrizzleClient(raw);
  const params = ['private-value'];
  client.unsafe('select $1', params);
  expect(unsafe).toHaveBeenCalledWith('select $1', params, { prepare: true });
  expect(raw.unsafe).toBe(unsafe);
  expect(preparedDrizzleClient(raw)).toBe(client);
});
it('adapts the transaction client without changing the BEGIN implementation', async () => {
  const unsafe = vi.fn();
  const transaction = { unsafe };
  const begin = vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
    callback(transaction),
  );
  const raw = { unsafe: vi.fn(), begin };
  const client = preparedDrizzleClient(raw);
  await client.begin(async (tx: typeof transaction) => tx.unsafe('select $1', [42]));
  expect(begin).toHaveBeenCalledTimes(1);
  expect(unsafe).toHaveBeenCalledWith('select $1', [42], { prepare: true });
  expect(raw.begin).toBe(begin);
});
it('preserves explicit query options and propagates query failures', () => {
  const error = new Error('query failed');
  const unsafe = vi.fn((..._args: unknown[]) => {
    throw error;
  });
  const client = preparedDrizzleClient({ unsafe });
  expect(() => client.unsafe('select $1', [42], { prepare: false })).toThrow(error);
  expect(unsafe).toHaveBeenCalledWith('select $1', [42], { prepare: false });
});
