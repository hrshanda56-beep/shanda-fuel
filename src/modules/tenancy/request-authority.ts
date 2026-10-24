import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantExecutionContext } from './authority';

const scope = new AsyncLocalStorage<
  WeakMap<Request, Map<string, Promise<TenantExecutionContext>>>
>();
/** Explicitly limited to one server request; never a global user/tenant cache. */
export function withRequestAuthority<T>(work: () => Promise<T>): Promise<T> {
  return scope.run(new WeakMap(), work);
}
export function reuseRequestAuthority(
  request: Request,
  tenantId: string,
  work: () => Promise<TenantExecutionContext>,
) {
  const store = scope.getStore();
  if (!store) return work();
  let tenants = store.get(request);
  if (!tenants) {
    tenants = new Map();
    store.set(request, tenants);
  }
  let result = tenants.get(tenantId);
  if (!result) {
    result = work();
    tenants.set(tenantId, result);
  }
  return result;
}
