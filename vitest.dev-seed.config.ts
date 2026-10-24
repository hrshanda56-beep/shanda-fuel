import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const serverOnlyShim = fileURLToPath(new URL('./tests/vitest/server-only.ts', import.meta.url));

// Runs the local demo-data seed. It reuses the integration harness (mocked Clerk sessions) so the
// seed drives the real commands. Local development databases only; see scripts/dev-demo-seed.
export default defineConfig({
  resolve: { alias: { 'server-only': serverOnlyShim } },
  test: {
    environment: 'node',
    setupFiles: ['./tests/vitest/environment.ts', './tests/vitest/clerk-integration.ts'],
    include: ['scripts/dev-demo-seed/**/*.seed.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
