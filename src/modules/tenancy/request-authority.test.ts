import { expect, it, vi } from 'vitest';
import { reuseRequestAuthority, withRequestAuthority } from './request-authority';
import type { TenantExecutionContext } from './authority';
it('deduplicates only the same request and tenant within one execution scope', async () => {
  const request = new Request('http://localhost/api/dashboard');
  const work = vi.fn(async () => ({}) as TenantExecutionContext);
  await withRequestAuthority(async () => {
    await Promise.all([
      reuseRequestAuthority(request, 'a', work),
      reuseRequestAuthority(request, 'a', work),
    ]);
    expect(work).toHaveBeenCalledTimes(1);
    await reuseRequestAuthority(request, 'b', work);
    await reuseRequestAuthority(new Request(request), 'a', work);
    expect(work).toHaveBeenCalledTimes(3);
  });
  await withRequestAuthority(() => reuseRequestAuthority(request, 'a', work));
  expect(work).toHaveBeenCalledTimes(4);
});
it('does not cache when no request scope exists', async () => {
  const request = new Request('http://localhost/api/dashboard');
  const work = vi.fn(async () => ({}) as TenantExecutionContext);
  await reuseRequestAuthority(request, 'a', work);
  await reuseRequestAuthority(request, 'a', work);
  expect(work).toHaveBeenCalledTimes(2);
});
