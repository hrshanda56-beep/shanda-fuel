import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Owner feedback (#252): no side panels anywhere. Every entry flow is a page guide
 * (`Modal presentation="page"`), a plain confirm dialog, or a page view. This keeps a side panel
 * from coming back by accident; the `side` presentation itself stays in the design system only so
 * old links to its styles do not break.
 */
const ROOT = join(process.cwd(), 'src');
const ALLOWED = new Set([join(ROOT, 'design-system', 'modal.tsx')]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe('no side panels (#252)', () => {
  it('no screen asks for a side panel', () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => /presentation=(?:"side"|\{'side'\})/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
