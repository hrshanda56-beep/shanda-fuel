import { chromium, type FullConfig } from '@playwright/test';
import { globSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

/** Compile development routes before scenario budgets start. No fixtures or writes. */
export default async function warmDevelopmentRoutes(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL !== 'http://127.0.0.1:3119' || !config.configFile) {
    throw new Error('Development warm-up requires the isolated local PostgreSQL runner');
  }
  const routes = globSync('src/app/**/page.tsx', { cwd: dirname(config.configFile) })
    .map((file) => {
      const route = file
        .split(sep)
        .join('/')
        .replace(/^src\/app/, '')
        .replace(/\/page\.tsx$/, '');
      return (
        route.replace(/\[([^\]]+)\]/g, (_segment, parameter: string) => {
          if (parameter === 'slug') return 'sales';
          if (parameter === 'token') return 'not-a-valid-token';
          if (parameter.startsWith('...')) throw new Error('Warm-up needs a catch-all example');
          return '00000000-0000-4000-8000-000000000001';
        }) || '/'
      );
    })
    .sort();
  if (!routes.length) throw new Error('No application pages found for development warm-up');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { 'x-shanda-e2e-navigation-fixture': 'synthetic' },
    });
    const tracePath = resolve(
      `${process.env.E2E_REPORT ?? 'test-results/postgres-dev.json'}.warmup.zip`,
    );
    mkdirSync(dirname(tracePath), { recursive: true });
    await context.tracing.start({ snapshots: true, sources: true });
    try {
      for (const route of routes) {
        // Aliases can redirect to the next route. A fresh page prevents a
        // same-document navigation from being mistaken for a compiled response.
        const page = await context.newPage();
        try {
          const start = Date.now();
          const response = await page.goto(route, { waitUntil: 'load', timeout: 120_000 });
          if (!response?.ok()) {
            throw new Error(`Development warm-up failed: ${route} returned ${response?.status()}`);
          }
          console.log(`[development warm-up] ${route}: ready in ${Date.now() - start}ms`);
        } finally {
          await page.close();
        }
      }

      // Compile required control-room GET handlers without authentication or mutation.
      // The normal guards must still reject every request before any fixture exists.
      for (const route of [
        '/api/context',
        '/api/forecourt/operations/overview',
        '/api/forecourt/operations/daily',
        '/api/forecourt/my-shift',
        '/api/auth/mfa/setup',
      ]) {
        const response = await context.request.get(route, { timeout: 120_000 });
        if (response.status() !== 401) {
          throw new Error(
            `Unauthenticated warm-up expected 401: ${route} returned ${response.status()}`,
          );
        }
        console.log(`[development warm-up] ${route}: compiled; unauthenticated access denied`);
      }
    } finally {
      await context.tracing.stop({ path: tracePath });
    }
  } finally {
    await browser.close();
  }
}
