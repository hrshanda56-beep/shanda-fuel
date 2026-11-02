import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The app connects as `app_runtime`, which can read `app.users` but not update it. A bare
 * `FOR UPDATE` on a query that joins `app.users` also tries to lock the user rows, so the database
 * refuses it ("permission denied for table users") and an email invitation fails with a generic
 * server error. The integration tests run as a superuser and cannot see this, so the rule is
 * checked here: such a query must lock only the table it changes.
 */
describe('staff command row locks', () => {
  it('never locks app.users rows when a query joins them', () => {
    const source = readFileSync('src/modules/staff/commands.ts', 'utf8');
    const queries = source.match(/sql`[^`]*`/g) ?? [];
    const joinsUsers = queries.filter(
      (query) => /join\s+app\.users\b/i.test(query) && /\bfor\s+update\b/i.test(query),
    );
    expect(joinsUsers.length).toBeGreaterThan(0);
    for (const query of joinsUsers) expect(query).toMatch(/for\s+update\s+of\s+membership/i);
  });
});
