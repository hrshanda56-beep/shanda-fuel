import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  postgres: vi.fn(() => ({ end: vi.fn() })),
  drizzle: vi.fn(() => ({})),
}));
vi.mock('postgres', () => ({ default: mocks.postgres }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mocks.drizzle }));
vi.mock('../config/env', () => ({
  assertDatabaseConfigured: () => 'postgres://test.invalid/test',
}));
vi.mock('./schema', () => ({}));
import { closeDatabase, getDatabase } from './client';
afterEach(async () => {
  await closeDatabase();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('keeps prepared statements disabled unless explicitly enabled', () => {
  vi.stubEnv('DATABASE_PREPARED_STATEMENTS', '');
  getDatabase();
  expect(mocks.postgres).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ prepare: false, max: 10 }),
  );
});
it('enables protocol prepared statements for the explicit evaluation setting', () => {
  vi.stubEnv('DATABASE_PREPARED_STATEMENTS', '1');
  getDatabase();
  expect(mocks.postgres).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ prepare: true }),
  );
});
it('does not treat an invalid setting as permission to enable prepared statements', () => {
  vi.stubEnv('DATABASE_PREPARED_STATEMENTS', 'yes');
  getDatabase();
  expect(mocks.postgres).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ prepare: false }),
  );
});
