import { vi } from 'vitest';
// Fixture setup uses DATABASE_URL; the application uses an actual runtime-role
// connection. This test-only override is never loaded by the application.
vi.mock('../../src/platform/config/env', async (original) => {
  const actual = await original<typeof import('../../src/platform/config/env')>();
  return {
    ...actual,
    assertDatabaseConfigured: () => {
      const value = process.env.FINANCE_RUNTIME_DATABASE_URL;
      if (!value) throw new Error('FINANCE_RUNTIME_DATABASE_URL is required');
      const url = new URL(value);
      if (url.hostname !== '127.0.0.1' || url.username !== 'app_runtime')
        throw new Error('Dedicated local app_runtime connection required');
      return value;
    },
  };
});
