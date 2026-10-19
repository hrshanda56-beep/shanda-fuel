import { defineConfig } from 'vitest/config';
import integration from './vitest.integration.config';
export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    include: ['tests/integration/finance-read-performance.test.ts'],
    setupFiles: [
      ...((integration.test?.setupFiles ?? []) as string[]),
      './tests/vitest/finance-runtime.ts',
    ],
  },
});
