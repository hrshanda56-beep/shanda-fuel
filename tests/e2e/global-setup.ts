import type { FullConfig } from '@playwright/test';

// Compile development routes before timing browser interactions. Cold Next.js
// compilation otherwise consumes navigation assertions and multi-page budgets.
// These are GET-only synthetic navigation fixtures, never production fixtures.
export default async function prepareDevelopmentRoutes(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL !== 'http://127.0.0.1:3100' || process.env.APP_ENV !== 'test') {
    throw new Error('Browser warmup requires the isolated loopback APP_ENV=test runner');
  }
  for (const path of [
    '/',
    '/foundation',
    '/login',
    '/reports',
    '/reports/sales',
    '/operations/daily',
    '/inventory',
    '/inventory/valuation',
    '/suppliers',
    '/settings',
    '/stations/station-1/reconciliations',
    '/stations/demo-station/cash',
    '/stations/demo-station/settlements',
    '/no-such-page',
  ]) {
    const response = await fetch(new URL(path, baseURL), {
      headers: { 'x-shanda-e2e-navigation-fixture': 'synthetic' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    await response.arrayBuffer();
    if (response.status >= 500) {
      throw new Error(`Development route warmup failed: ${path} (${response.status})`);
    }
  }
}
