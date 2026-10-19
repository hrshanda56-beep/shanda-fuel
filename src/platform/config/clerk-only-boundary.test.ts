import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'migrations' ? [] : runtimeSources(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('Clerk-only authentication boundary', () => {
  it('cannot reintroduce an alternate runtime credential provider', () => {
    const violations = [
      ...runtimeSources(resolve('src')),
      ...runtimeSources(resolve('scripts')),
    ].filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /(?:from\s+|import\s*\()['"]better-auth(?:\/|['"])/.test(source);
    });
    expect(violations).toEqual([]);
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(manifest.dependencies).not.toHaveProperty('better-auth');
    expect(manifest.devDependencies).not.toHaveProperty('better-auth');
  });

  it('does not select authentication using an environment toggle', () => {
    const violations = runtimeSources(resolve('src')).filter((path) =>
      /process\.env\.AUTH_PROVIDER/.test(readFileSync(path, 'utf8')),
    );
    expect(violations).toEqual([]);
  });
});
