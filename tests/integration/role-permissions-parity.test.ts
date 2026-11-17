import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_CODES } from '../../src/platform/security/permissions';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the role permissions parity test.');
}

/**
 * D2: the permissions each role holds in the database (what the migrations seeded) against the
 * permissions the code gives it.
 *
 * - The three roles added by migration 0094 must match the code exactly.
 * - For the original five, the database must never grant a permission the code does not. The
 *   database is missing some grants the code has (for example the cash permissions of 0006); the
 *   application authorises from the code, so that gap is recorded in docs/AUDIT2.md as a finding
 *   and is not asserted away here.
 */
const ADDED_BY_0094 = ['AUDITOR', 'AREA_MANAGER', 'CASH_COLLECTOR'] as const;

let client: Sql;

describe('role permissions in the database against the code (D2)', () => {
  beforeAll(() => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => {
    await client.end();
  });

  it('defines every role', async () => {
    const rows = await client<{ code: string }[]>`select code from platform.role_definitions`;
    expect(rows.map((row) => row.code).sort()).toEqual([...ROLE_CODES].sort());
  });

  async function difference(role: string) {
    const rows = await client<{ permission_code: string }[]>`
      select permission_code from platform.role_permissions where role_code = ${role}
    `;
    const inDatabase = new Set(rows.map((row) => row.permission_code));
    // A permission the database does not define at all cannot be granted there; the code grants it.
    const defined = new Set(
      (await client<{ code: string }[]>`select code from platform.permission_definitions`).map(
        (row) => row.code,
      ),
    );
    const inCode = new Set<string>(
      DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS].filter((code) =>
        defined.has(code),
      ),
    );
    return {
      inCodeButNotDatabase: [...inCode].filter((code) => !inDatabase.has(code)).sort(),
      inDatabaseButNotCode: [...inDatabase].filter((code) => !inCode.has(code)).sort(),
    };
  }

  for (const role of ADDED_BY_0094) {
    it(`${role} holds exactly the permissions the code gives it`, async () => {
      expect(await difference(role)).toEqual({
        inCodeButNotDatabase: [],
        inDatabaseButNotCode: [],
      });
    });
  }

  for (const role of ROLE_CODES.filter(
    (code) => !(ADDED_BY_0094 as readonly string[]).includes(code),
  )) {
    it(`${role}: the database never grants more than the code`, async () => {
      expect((await difference(role)).inDatabaseButNotCode).toEqual([]);
    });
  }
});

describe('supervisor price request (migration 0105)', () => {
  it('SUPERVISOR and AREA_MANAGER may request a price change but not approve or activate', async () => {
    const own = postgres(databaseUrl!, { max: 1, prepare: false });
    try {
      const rows = await own<{ role_code: string; permission_code: string }[]>`
        select role_code, permission_code from platform.role_permissions
        where role_code in ('SUPERVISOR', 'AREA_MANAGER') and permission_code like 'price.change.%'
      `;
      const held = rows.map((row) => `${row.role_code}:${row.permission_code}`);
      expect(held).toContain('SUPERVISOR:price.change.request');
      expect(held).toContain('AREA_MANAGER:price.change.request');
      expect(held.filter((entry) => /approve|activate/.test(entry))).toEqual([]);
    } finally {
      await own.end();
    }
  });
});
