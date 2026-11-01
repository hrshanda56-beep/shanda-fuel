import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const serverOnlyShim = fileURLToPath(new URL('./tests/vitest/server-only.ts', import.meta.url));
const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  // `@/` is the same alias the application and the unit tests use; some routes import through it.
  resolve: { alias: { 'server-only': serverOnlyShim, '@': sourceRoot } },
  test: {
    environment: 'node',
    setupFiles: ['./tests/vitest/environment.ts', './tests/vitest/clerk-integration.ts'],
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
