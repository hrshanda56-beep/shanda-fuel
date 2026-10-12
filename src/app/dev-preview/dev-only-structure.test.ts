import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { navigationSections } from '@/design-system/navigation';

/**
 * Structural coverage: every routable file under the development-only prefixes
 * names the fail-closed predicate, and nothing in production code links there.
 */

const root = process.cwd();
const PREFIXES = ['src/app/dev-preview', 'src/app/design-system', 'src/app/foundation'];
const ROUTE_FILE = /^(page|route|layout|default|template|loading|error|not-found)\.(ts|tsx)$/;
// The negated call, not merely the import: `if (!isDevOnlySurfaceAvailable()) …`.
const GUARD = /!\s*(isDevOnlySurfaceAvailable|isDesignSystemReferenceAvailable)\(\)/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('development-only route guards', () => {
  const routeFiles = PREFIXES.flatMap((prefix) => walk(join(root, prefix))).filter((file) =>
    ROUTE_FILE.test(file.split('/').pop()!),
  );

  it('discovers the routable files', () => {
    expect(routeFiles.length).toBeGreaterThanOrEqual(12);
  });

  // Passive files (loading/error/not-found/template) render nothing sensitive
  // on their own; pages, handlers and layouts must each carry the guard.
  it.each(routeFiles.filter((f) => /\/(page|route|layout)\.(ts|tsx)$/.test(f)))(
    '%s uses the fail-closed predicate',
    (file) => {
      expect(readFileSync(file, 'utf8'), relative(root, file)).toMatch(GUARD);
    },
  );
});

describe('production navigation and sources do not expose development-only routes', () => {
  it('no navigation destination or match pattern targets them', () => {
    for (const section of navigationSections) {
      for (const item of section.items) {
        const destination = JSON.stringify(item.destination);
        expect(destination).not.toMatch(/dev-preview|design-system|foundation/);
        expect(item.match.map(String).join(' ')).not.toMatch(
          /dev-preview|design-system|foundation/,
        );
      }
    }
  });

  it('no production source links to them', () => {
    const offenders = walk(join(root, 'src'))
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => !PREFIXES.some((prefix) => file.startsWith(join(root, prefix))))
      .filter((file) => !file.includes(`${join('src', 'design-system', 'reference')}`))
      .filter((file) =>
        /['"`]\/(dev-preview|design-system|foundation)(['"`/?#])/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
