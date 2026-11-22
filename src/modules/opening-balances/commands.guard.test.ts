import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Locking a batch posts each line with hand-written SQL. The database driver cannot send a
 * JavaScript `Date` as a bare parameter in such a statement (it fails with "The string argument
 * must be of type string ... Received an instance of Date"), so a batch with a cash or customer
 * line could be approved but never locked. Times go in as ISO text with an explicit cast.
 *
 * This is a quick guard on the source. The real create, approve and lock round trip, with a tank,
 * cash, bank, customer and supplier line, is `tests/integration/opening-balances-wizard.test.ts`.
 */
describe('opening balance locking SQL', () => {
  const source = readFileSync(new URL('./commands.ts', import.meta.url), 'utf8');

  it('never passes a Date straight into a raw sql statement', () => {
    expect(source).not.toMatch(/\$\{effectiveAt\}/);
  });

  it('sends the cash and customer times as text with a timestamptz cast', () => {
    expect(source.match(/\$\{effectiveAt\.toISOString\(\)\}::timestamptz/g)).toHaveLength(2);
  });
});
