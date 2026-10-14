import { defineConfig, devices } from '@playwright/test';

const e2eBaseUrl = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'on-first-retry',
  },
  webServer: {
    // Keep Better Auth's trusted origin identical to Playwright's base URL.
    command: `APP_URL=${e2eBaseUrl} APP_ENV=test AUTH_PROVIDER=BETTER_AUTH pnpm dev --webpack --hostname 127.0.0.1 --port 3100`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        extraHTTPHeaders: { 'x-shanda-e2e-navigation-fixture': 'synthetic' },
      },
    },
  ],
});
