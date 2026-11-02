import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the attendant eligibility grants test.');
}

let client: ReturnType<typeof postgres>;

/**
 * Two things the application role needs that the other integration tests (which connect as a
 * privileged role) cannot notice are missing:
 *
 * - Naming a responsible attendant checks that the person is an attendant at the station. Station
 *   supervisors cannot read other people's memberships (row-level security), so the check is a
 *   narrow yes/no SECURITY DEFINER function (0098).
 * - Confirming a bank deposit updates bank_date and confirmation_reason, columns that need their own
 *   column-level grants (0099).
 */
describe('attendant eligibility and deposit confirmation privileges', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  async function runtimeRolePresent(): Promise<boolean> {
    const role = await client<{ present: boolean }[]>`
      select exists (select 1 from pg_roles where rolname = 'app_runtime') as present
    `;
    return role[0]?.present === true;
  }

  it('answers "is this person an attendant here" through a pinned definer function', async () => {
    const rows = await client<{ definer: boolean; config: string[] | null; result: string }[]>`
      select p.prosecdef as definer, p.proconfig as config, pg_get_function_result(p.oid) as result
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'is_station_attendant'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.definer).toBe(true);
    expect(rows[0]?.result).toBe('boolean');
    expect(rows[0]?.config?.some((setting) => setting.startsWith('search_path='))).toBe(true);
  });

  it('lets only the application role run it, and gives an unauthenticated caller "no"', async () => {
    if (!(await runtimeRolePresent())) return;
    const privileges = await client<{ runtime: boolean; public_: boolean }[]>`
      select has_function_privilege('app_runtime', 'app.is_station_attendant(uuid, uuid, uuid)', 'EXECUTE') as runtime,
             has_function_privilege('public', 'app.is_station_attendant(uuid, uuid, uuid)', 'EXECUTE') as public_
    `;
    expect(privileges[0]).toEqual({ runtime: true, public_: false });

    // With no tenant or membership in the session, the answer is false rather than an error.
    const answer = await client.begin(async (transaction) => {
      await transaction.unsafe('set local role app_runtime');
      return transaction<{ eligible: boolean }[]>`
        select app.is_station_attendant(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()) as eligible
      `;
    });
    expect(answer[0]?.eligible).toBe(false);
  });

  it('lets the application role record the bank date and difference reason on a deposit', async () => {
    if (!(await runtimeRolePresent())) return;
    const columns = await client<{ column_name: string; allowed: boolean }[]>`
      select c as column_name,
             has_column_privilege('app_runtime', 'app.bank_deposits', c, 'UPDATE') as allowed
      from unnest(array['bank_date', 'confirmation_reason', 'bank_reference', 'confirmed_amount', 'state']) as c
    `;
    expect(columns.filter((column) => !column.allowed)).toEqual([]);

    // The columns the application must never rewrite stay locked.
    const locked = await client<{ allowed: boolean }[]>`
      select has_column_privilege('app_runtime', 'app.bank_deposits', 'amount', 'UPDATE') as allowed
    `;
    expect(locked[0]?.allowed).toBe(false);
  });
});
