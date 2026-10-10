import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const serverOnlyShim = fileURLToPath(new URL('./tests/vitest/server-only.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { 'server-only': serverOnlyShim } },
  test: {
    environment: 'node',
    setupFiles: ['./tests/vitest/environment.ts'],
    include: ['tests/integration/**/*.test.ts'],
    passWithNoTests: false,
    // Integration files share one live PostgreSQL database. Some tests install
    // a temporary global fault-injection trigger (e.g. on platform.security_events)
    // for the duration of a single test; running files in parallel lets an
    // unrelated file's legitimate command land mid-window and be rejected by
    // that trigger. Running files sequentially keeps the shared database state
    // deterministic across files.
    fileParallelism: false,
  },
});
