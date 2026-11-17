import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The application connects as `app_runtime`. That role may read and add rows to the append-only
 * ledgers (allocations, movements, versions, ...) but may not update them, and PostgreSQL refuses
 * a row lock (`FOR UPDATE`, `FOR SHARE`, ...) on a table the role cannot update. Every other
 * integration test seeds and runs as a superuser, so a lock like that passes the whole suite and
 * then fails for real people with a generic "something went wrong" (it broke email staff
 * invitations, supplier reversals, provider payout matching and meter exceptions).
 *
 * This test takes every locking statement the application source contains and runs it as
 * `app_runtime`, so the database itself says whether the lock is allowed.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the row-lock test.');

const LOCK = /\bfor\s+(?:no\s+key\s+)?(?:update|share)\b|\bfor\s+key\s+share\b/i;
let client: Sql;

/** Replaces every `${...}` (balanced braces) with NULL, so a template becomes plain SQL. */
function withNulls(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        i += 1;
      }
      i -= 1;
      out += 'NULL';
    } else out += text[i];
  }
  return out;
}

function sourceFiles(pattern: string): string[] {
  return execSync(`grep -rliE ${JSON.stringify(pattern)} src --include=*.ts`, { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file && !file.includes('.test.'));
}

/** True when `app_runtime` is refused (permission denied, SQLSTATE 42501) running the statement. */
async function refusedForRuntime(statement: string): Promise<boolean> {
  try {
    await client.begin(async (transaction) => {
      await transaction.unsafe('set local role app_runtime');
      await transaction.unsafe(statement);
      throw new Error('rollback');
    });
  } catch (error) {
    return (error as { code?: string }).code === '42501';
  }
  return false;
}

describe('row locks in the application source, run as the application role', () => {
  beforeAll(() => {
    client = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => client?.end());

  it('has no raw SQL row lock that app_runtime is refused', async () => {
    const refused: string[] = [];
    let checked = 0;
    for (const file of sourceFiles('for (no key )?(update|share)|for key share')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/sql`((?:[^`\\]|\\.)*?)`/gs)) {
        const body = match[1]!;
        if (!LOCK.test(body)) continue;
        // Only statements that read (select ... for update); the lock in "update ..." is the write.
        if (/^\s*(update|insert|delete)\b/i.test(body)) continue;
        checked += 1;
        const line = text.slice(0, match.index).split('\n').length;
        if (await refusedForRuntime(withNulls(body).replace(/;\s*$/, '')))
          refused.push(`${file}:${line}`);
      }
    }
    // A scanner that quietly stops finding statements would pass this test for the wrong reason.
    expect(checked).toBeGreaterThan(80);
    expect(refused, 'row locks that app_runtime is not allowed to take').toEqual([]);
  });

  it('has no ORM row lock on a table app_runtime cannot update', async () => {
    // Map each drizzle table identifier to its table name, then look at what each `.for(...)` locks.
    const tableOf = new Map<string, string>();
    for (const file of sourceFiles('(pgTable|\\.table)\\(')) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /export const (\w+)\s*=\s*[\w.]*(?:pgTable|table)\(\s*['"](\w+)['"]/g,
      ))
        tableOf.set(m[1]!, m[2]!);
    }
    const sites = execSync(`grep -rnE "\\.for\\(['\\"]" src --include=*.ts`, { encoding: 'utf8' })
      .split('\n')
      .filter((site) => site && !site.includes('.test.'));
    const refused: string[] = [];
    for (const site of sites) {
      const [file, lineText] = site.split(':') as [string, string];
      const lines = readFileSync(file, 'utf8').split('\n');
      const line = Number(lineText);
      const window = lines.slice(Math.max(0, line - 30), line).join('\n');
      const froms = [...window.matchAll(/\.(?:from|innerJoin|leftJoin)\(\s*(\w+)/g)];
      const table = tableOf.get(froms.at(-1)?.[1] ?? '');
      expect(table, `${file}:${line} locks a table this test cannot identify`).toBeTruthy();
      if (await refusedForRuntime(`select 1 from app."${table}" limit 1 for update`))
        refused.push(`${file}:${line} (${table})`);
    }
    expect(sites.length).toBeGreaterThan(10);
    expect(refused, 'ORM row locks that app_runtime is not allowed to take').toEqual([]);
  });
});
