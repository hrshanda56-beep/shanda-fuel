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
it('prepares parameterised queries even though Drizzle always passes prepare: false for raw SQL', () => {
  // Drizzle's session calls unsafe(sql, params, { prepare: false }) for every unnamed query, so an
  // adapter that lets the caller's value win would never prepare anything.
  const unsafe = vi.fn();
  const client = preparedDrizzleClient({ unsafe });
  client.unsafe('select $1', [42], { prepare: false });
  expect(unsafe).toHaveBeenCalledWith('select $1', [42], { prepare: true });
});
it('keeps every other query option and leaves parameterless queries as the caller sent them', () => {
  const unsafe = vi.fn();
  const client = preparedDrizzleClient({ unsafe });
  client.unsafe('select $1', [42], { prepare: false, simple: false });
  expect(unsafe).toHaveBeenCalledWith('select $1', [42], { prepare: true, simple: false });
  client.unsafe('select 1', [], { prepare: false });
  expect(unsafe).toHaveBeenLastCalledWith('select 1', [], { prepare: false });
});
it('propagates query failures unchanged', () => {
  const error = new Error('query failed');
  const unsafe = vi.fn((..._args: unknown[]) => {
    throw error;
  });
  const client = preparedDrizzleClient({ unsafe });
  expect(() => client.unsafe('select $1', [42], { prepare: false })).toThrow(error);
});
