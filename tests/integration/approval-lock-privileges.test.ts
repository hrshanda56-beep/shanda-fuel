import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for the approval lock privilege test. Configure a dedicated PostgreSQL test database.',
  );
}

let client: ReturnType<typeof postgres>;

/**
 * Approving a reconciliation runs as the application role, which has no UPDATE on the append-only
 * ledger tables. Postgres treats a row lock (SELECT ... FOR SHARE / FOR UPDATE) as an UPDATE, so a
 * trigger that locks such a table must run as its owner or every approval fails with "permission
 * denied". The other integration tests connect as a privileged role and cannot see this, so this
 * reads the catalog instead.
 */
describe('triggers that lock tables the application role cannot update', () => {
  beforeAll(() => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('run as their owner', async () => {
    const role = await client<{ present: boolean }[]>`
      select exists (select 1 from pg_roles where rolname = 'app_runtime') as present
    `;
    // Without the application role there is nothing to lack a privilege.
    if (!role[0]?.present) return;

    const functions = await client<{ name: string; source: string; definer: boolean }[]>`
      select p.proname as name, p.prosrc as source, p.prosecdef as definer
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.prorettype = 'trigger'::regtype
        and p.prosrc ~* 'for[[:space:]]+(share|update|no[[:space:]]+key[[:space:]]+update|key[[:space:]]+share)'
    `;
    expect(functions.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const fn of functions) {
      if (fn.definer) continue;
      // Every table the function reads with a lock on it: "from app.<table> ... for share".
      const tables = new Set(
        [
          ...fn.source.matchAll(
            /from\s+app\.([a-z_]+)[^;]*?for\s+(?:share|update|no\s+key\s+update|key\s+share)/gis,
          ),
        ].map((match) => match[1]!),
      );
      for (const table of tables) {
        const allowed = await client<{ allowed: boolean }[]>`
          select has_table_privilege('app_runtime', ${`app.${table}`}, 'UPDATE') as allowed
        `;
        if (!allowed[0]?.allowed) offenders.push(`${fn.name} locks app.${table}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps a fixed search path on the ones that run as their owner', async () => {
    const rows = await client<{ name: string; config: string[] | null }[]>`
      select p.proname as name, p.proconfig as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.prorettype = 'trigger'::regtype
        and p.prosecdef
        and p.prosrc ~* 'for[[:space:]]+(share|update|no[[:space:]]+key[[:space:]]+update|key[[:space:]]+share)'
    `;
    for (const row of rows) {
      expect(
        row.config?.some((setting) => setting.startsWith('search_path=')),
        `${row.name} must pin its search path`,
      ).toBe(true);
    }
  });
});
