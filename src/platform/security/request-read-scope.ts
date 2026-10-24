import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';

type ReadStore = Map<symbol, Map<string, Promise<unknown>>>;
const apiScope = new AsyncLocalStorage<ReadStore>();
// React invalidates this store for each server render. Outside a render,
// cache() does not persist results, so non-GET commands never share a cache.
const renderScope = cache((): ReadStore => new Map());

export function withRequestReadScope<T>(work: () => Promise<T>): Promise<T> {
  return apiScope.getStore() ? work() : apiScope.run(new Map(), work);
}

export function memoizeRequestRead<T>(
  namespace: symbol,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const store = apiScope.getStore() ?? renderScope();
  let reads = store.get(namespace);
  if (!reads) {
    reads = new Map();
    store.set(namespace, reads);
  }
  const existing = reads.get(key);
  if (existing) return existing as Promise<T>;
  const result = work();
  reads.set(key, result);
  return result;
}
