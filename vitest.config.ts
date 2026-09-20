import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const serverOnlyShim = fileURLToPath(new URL('./tests/vitest/server-only.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { 'server-only': serverOnlyShim } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
