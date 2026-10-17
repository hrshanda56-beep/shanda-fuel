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
    '/invite/not-a-valid-token',
    // Acceptance redirects to Today, which starts these handlers concurrently.
    // Compile them serially before browser budgets begin. GET cannot invoke
    // the POST-only invitation mutation handlers (Next.js answers 405).
    '/api/health',
    '/api/reports/daily',
    '/api/reports/management',
    '/api/customers/summary',
    '/api/forecourt/operations/overview',
    '/api/invite/synthetic-compiler-warmup/signup',
    '/api/invite/synthetic-compiler-warmup/accept',
  ]) {
    const started = performance.now();
    const response = await fetch(new URL(path, baseURL), {
      headers: { 'x-shanda-e2e-navigation-fixture': 'synthetic' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    await response.arrayBuffer();
    console.info(
      `Development warmup: ${path} ${response.status} ${Math.round(performance.now() - started)}ms`,
    );
    if (response.status >= 500) {
      throw new Error(`Development route warmup failed: ${path} (${response.status})`);
    }
  }
}
