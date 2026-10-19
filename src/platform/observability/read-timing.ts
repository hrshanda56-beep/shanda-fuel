import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage<{
  route: string;
  start: number;
  last: number;
  profileSql: boolean;
}>();
export function markReadTiming(stage: string): void {
  const s = scope.getStore();
  if (!s) return;
  const now = performance.now();
  console.info(
    '[DEBUG-read-latency]',
    JSON.stringify({
      route: s.route,
      stage,
      elapsedMs: Math.round(now - s.start),
      sincePreviousMs: Math.round(now - s.last),
    }),
  );
  s.last = now;
}
export async function withReadTiming<T>(
  route: string,
  work: () => Promise<T>,
  profileSql = false,
): Promise<T> {
  if (process.env.APP_ENV !== 'local') return work();
  const now = performance.now();
  return scope.run({ route, start: now, last: now, profileSql }, async () => {
    try {
      return await work();
    } finally {
      markReadTiming('request.complete');
    }
  });
}

type Executor = Pick<Parameters<Parameters<Database['transaction']>[0]>[0], 'execute'>;
/** Explicit local diagnostic only. EXPLAIN ANALYZE repeats this read in the same RLS transaction. */
export async function profileDatabaseRead<T extends Record<string, unknown>>(
  executor: Executor,
  query: SQL,
) {
  const started = performance.now();
  const rows = await executor.execute<T>(query);
  const clientMs = performance.now() - started;
  const state = scope.getStore();
  if (state?.profileSql) {
    const explainStarted = performance.now();
    const plans = await executor.execute<{
      'QUERY PLAN': Array<{ 'Planning Time': number; 'Execution Time': number }>;
    }>(sql`explain (analyze, timing false, format json) ${query}`);
    const plan = plans[0]?.['QUERY PLAN'][0];
    console.info(
      '[DEBUG-sql-eval]',
      JSON.stringify({
        route: state.route,
        clientMs: Math.round(clientMs),
        explainClientMs: Math.round(performance.now() - explainStarted),
        serverPlanningMs: plan?.['Planning Time'],
        serverExecutionMs: plan?.['Execution Time'],
      }),
    );
  }
  return rows;
}
