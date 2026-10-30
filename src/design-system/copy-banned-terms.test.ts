import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * C4 / G5: internal terms must never reach a person's screen. This scans the shipped source (not
 * tests, not the dev preview) for the phrases people should never read, after removing comments,
 * so a developer note cannot trip it but a visible string always will. Add a phrase here when a new
 * piece of jargon is found; give it a plain replacement in the code, not an exception here.
 */
const BANNED: readonly { pattern: RegExp; say: string }[] = [
  { pattern: /compensating workflows?/i, say: 'a recorded correction' },
  { pattern: /valuation streams?/i, say: 'stock cost' },
  { pattern: /unmatched provider payment evidence/i, say: 'payments not yet matched to a payout' },
  { pattern: /production reconciliation/i, say: 'shift report' },
  { pattern: /\bdip refs?\b/i, say: 'tank dips' },
  { pattern: /\bForecourt:/, say: 'Daily operations:' },
  { pattern: /waiting for a supervisor/i, say: 'waiting for management approval' },
];

const ROOT = join(process.cwd(), 'src');
const SKIPPED_DIRS = new Set(['node_modules', 'dev-preview', 'dev-login', 'owner-demo']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no internal terms in what people read (C4)', () => {
  const files = sourceFiles(ROOT);

  it('scans a real set of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  for (const { pattern, say } of BANNED) {
    it(`never says ${pattern} (say "${say}")`, () => {
      const hits = files.filter((file) =>
        pattern.test(withoutComments(readFileSync(file, 'utf8'))),
      );
      expect(hits.map((file) => file.slice(ROOT.length + 1))).toEqual([]);
    });
  }
});
