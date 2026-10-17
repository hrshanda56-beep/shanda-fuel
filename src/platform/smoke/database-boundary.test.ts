import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const modulesRoot = join(sourceRoot, 'modules');

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function hasServerOnlyImport(source: string): boolean {
  return /(?:^|\n)\s*import\s+['"]server-only['"]\s*;?/.test(source);
}

describe('database boundary architecture', () => {
  it('keeps database access out of client components', () => {
    const violations = sourceFiles(sourceRoot)
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return (
          /['"]use client['"]/.test(source) &&
          /(?:drizzle-orm|platform\/db|DATABASE_URL|DATABASE_DIRECT_URL|@neondatabase|private object storage)/.test(
            source,
          )
        );
      })
      .map((path) => relative(sourceRoot, path));

    expect(violations).toEqual([]);
  });

  it('protects module database access with the server-only boundary', () => {
    const databaseImport =
      /(?:from\s+['"][^'"]*(?:platform\/db|drizzle-orm)[^'"]*['"]|transaction\.execute\s*\(|\.select\s*\()/;
    const violations = sourceFiles(modulesRoot)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        const isDatabaseModule = databaseImport.test(source);
        const isQueryModule = /\/(?:query|queries)\.ts$/.test(path);
        return (isDatabaseModule || isQueryModule) && !hasServerOnlyImport(source);
      })
      .map((path) => relative(sourceRoot, path));

    expect(violations).toEqual([]);
  });

  it('keeps authoritative numeric aggregation out of JavaScript query modules', () => {
    const violations = sourceFiles(modulesRoot)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => /\/(?:query|queries)\.ts$/.test(path))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return /\.reduce\s*\(|ExactDecimal\.(?:add|subtract|multiply|divide)\s*\(/.test(source);
      })
      .map((path) => relative(sourceRoot, path));

    expect(violations).toEqual([]);
  });

  it('does not accidentally treat directories as source files while scanning', () => {
    expect(statSync(modulesRoot).isDirectory()).toBe(true);
  });
});
