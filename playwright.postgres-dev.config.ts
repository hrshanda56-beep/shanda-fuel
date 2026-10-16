import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const fixtureUrl = process.env.DATABASE_FIXTURE_URL ?? process.env.DATABASE_URL;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
if (!fixtureUrl || !runtimeUrl || !process.env.BETTER_AUTH_SECRET) {
  throw new Error('Disposable fixture/runtime URLs and a synthetic auth secret are required');
}
const fixture = new URL(fixtureUrl);
const runtime = new URL(runtimeUrl);
if (
  ![fixture, runtime].every(
    (url) =>
      url.protocol === 'postgresql:' &&
      url.hostname === '127.0.0.1' &&
      /^\/remediation_[a-z0-9_]+$/.test(url.pathname),
  ) ||
  fixture.port !== runtime.port ||
  fixture.pathname !== runtime.pathname ||
  runtime.username !== 'app_runtime'
) {
  throw new Error('Refusing a non-disposable or mismatched local PostgreSQL runtime');
}
// Legacy fixture suites use DATABASE_URL; the server receives only the runtime URL.
process.env.DATABASE_URL = fixtureUrl;

// Dedicated development-mode matrix: no reused server, retries or parallel DB fixtures.
export default defineConfig({
  ...base,
  metadata: { testedSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  globalSetup: './tests/e2e/fixtures/development-warmup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: process.env.E2E_OUTPUT_DIR ?? 'test-results/postgres-dev',
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.E2E_REPORT ?? 'test-results/postgres-dev.json' }],
  ],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3119', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3119',
    url: 'http://127.0.0.1:3119',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      APP_ENV: 'test',
      AUTH_PROVIDER: 'BETTER_AUTH',
      APP_URL: 'http://127.0.0.1:3119',
      DATABASE_URL: runtimeUrl,
      DATABASE_DIRECT_URL: runtimeUrl,
      DATABASE_FIXTURE_URL: runtimeUrl,
      NODE_OPTIONS: '--max-old-space-size=4096',
      SHANDA_E2E_ISOLATED_CACHE: '1',
    },
  },
});
