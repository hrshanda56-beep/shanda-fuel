import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.OWNER_DEMO_PORT ?? '3110');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('OWNER_DEMO_PORT must be a valid local test port');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /owner-demo\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `APP_ENV=demo pnpm dev --webpack --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/owner-demo`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
