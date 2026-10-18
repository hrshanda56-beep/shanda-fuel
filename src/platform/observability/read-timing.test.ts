import { sql } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import { markReadTiming, withReadTiming, profileDatabaseRead } from './read-timing';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('records local stages and returns the original result', async () => {
  vi.stubEnv('APP_ENV', 'local');
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  expect(
    await withReadTiming('/probe', async () => {
      markReadTiming('data.ready');
      return 42;
    }),
  ).toBe(42);
  expect(log).toHaveBeenCalledTimes(2);
  const call = log.mock.calls[0];
  if (!call) throw new Error('Expected a timing log');
  expect(JSON.parse(call[1])).toMatchObject({ route: '/probe', stage: 'data.ready' });
});
it('preserves failures and records completion', async () => {
  vi.stubEnv('APP_ENV', 'local');
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const error = new Error('failure');
  await expect(
    withReadTiming('/probe', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const call = log.mock.calls[0];
  if (!call) throw new Error('Expected a completion timing log');
  expect(JSON.parse(call[1]).stage).toBe('request.complete');
});
it('does not log outside local mode', async () => {
  vi.stubEnv('APP_ENV', 'production');
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  await withReadTiming('/probe', async () => {
    markReadTiming('data.ready');
  });
  expect(log).not.toHaveBeenCalled();
});

it('profiles PostgreSQL execution separately while preserving the original read result', async () => {
  vi.stubEnv('APP_ENV', 'local');
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const rows = [{ id: 'result' }];
  const execute = vi
    .fn()
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([{ 'QUERY PLAN': [{ 'Planning Time': 0.5, 'Execution Time': 2.5 }] }]);
  const executor = { execute } as unknown as Parameters<typeof profileDatabaseRead>[0];
  expect(
    await withReadTiming('/probe', () => profileDatabaseRead(executor, sql`select 1`), true),
  ).toBe(rows);
  expect(execute).toHaveBeenCalledTimes(2);
  const entry = log.mock.calls.find((call) => call[0] === '[DEBUG-sql-eval]');
  if (!entry) throw new Error('Expected SQL profile');
  expect(JSON.parse(entry[1])).toMatchObject({ serverPlanningMs: 0.5, serverExecutionMs: 2.5 });
});
it('never repeats the query for an ordinary local request', async () => {
  vi.stubEnv('APP_ENV', 'local');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const execute = vi.fn().mockResolvedValue([]);
  await withReadTiming('/probe', () =>
    profileDatabaseRead(
      { execute } as unknown as Parameters<typeof profileDatabaseRead>[0],
      sql`select 1`,
    ),
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it('does not enable SQL profiling outside local mode', async () => {
  vi.stubEnv('APP_ENV', 'production');
  const execute = vi.fn().mockResolvedValue([]);
  await withReadTiming(
    '/probe',
    () =>
      profileDatabaseRead(
        { execute } as unknown as Parameters<typeof profileDatabaseRead>[0],
        sql`select 1`,
      ),
    true,
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it('propagates the original read failure without running EXPLAIN', async () => {
  vi.stubEnv('APP_ENV', 'local');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const execute = vi.fn().mockRejectedValue(new Error('read failed'));
  await expect(
    withReadTiming(
      '/probe',
      () =>
        profileDatabaseRead(
          { execute } as unknown as Parameters<typeof profileDatabaseRead>[0],
          sql`select 1`,
        ),
      true,
    ),
  ).rejects.toThrow('read failed');
  expect(execute).toHaveBeenCalledTimes(1);
});
