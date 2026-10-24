import { expect, it, vi } from 'vitest';
import { memoizeRequestRead, withRequestReadScope } from './request-read-scope';

it('deduplicates concurrent reads only inside the same request and key', async () => {
  const namespace = Symbol('test'),
    work = vi.fn(async () => ({ value: 1 }));
  await withRequestReadScope(async () => {
    const [first, second] = await Promise.all([
      memoizeRequestRead(namespace, 'user-a', work),
      memoizeRequestRead(namespace, 'user-a', work),
    ]);
    expect(first).toBe(second);
    expect(work).toHaveBeenCalledTimes(1);
    await memoizeRequestRead(namespace, 'user-b', work);
    expect(work).toHaveBeenCalledTimes(2);
  });
  await withRequestReadScope(() => memoizeRequestRead(namespace, 'user-a', work));
  expect(work).toHaveBeenCalledTimes(3);
});
it('keeps concurrent users and requests separate even with identical keys', async () => {
  const namespace = Symbol('test');
  const values = await Promise.all(
    ['alice', 'bob'].map((user) =>
      withRequestReadScope(async () => {
        await Promise.resolve();
        return memoizeRequestRead(namespace, 'same-key', async () => user);
      }),
    ),
  );
  expect(values).toEqual(['alice', 'bob']);
});
it('does not retain reads outside a request/render scope', async () => {
  const namespace = Symbol('test'),
    work = vi.fn(async () => 1);
  await memoizeRequestRead(namespace, 'a', work);
  await memoizeRequestRead(namespace, 'a', work);
  expect(work).toHaveBeenCalledTimes(2);
});
it('shares nested GET scopes without starting a second authority budget', async () => {
  const namespace = Symbol('test'),
    work = vi.fn(async () => 1);
  await withRequestReadScope(async () => {
    await memoizeRequestRead(namespace, 'a', work);
    await withRequestReadScope(() => memoizeRequestRead(namespace, 'a', work));
  });
  expect(work).toHaveBeenCalledTimes(1);
});
