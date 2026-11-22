import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from './permissions';

const sql = readFileSync(
  new URL('../db/migrations/0105_supervisor_price_request.sql', import.meta.url),
  'utf8',
);
const statements = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const grants = [...statements.matchAll(/\('([A-Z_]+)',\s*'([a-z_.]+)'\)/g)].map(
  (match) => `${match[1]}:${match[2]}`,
);

describe('migration 0105: supervisor may request a price change', () => {
  it('grants exactly the request permission to supervisor and area manager', () => {
    expect([...grants].sort()).toEqual([
      'AREA_MANAGER:price.change.request',
      'SUPERVISOR:price.change.request',
    ]);
  });

  it('never grants approval or activation, and only what the code also grants', () => {
    expect(statements).not.toMatch(/price\.change\.(approve|activate)/);
    for (const grant of grants) {
      const [role, code] = grant.split(':') as [keyof typeof DEFAULT_ROLE_PERMISSIONS, never];
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(code);
    }
  });
});
