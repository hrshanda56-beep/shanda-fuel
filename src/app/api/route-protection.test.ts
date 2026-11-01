import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const API_ROOT = __dirname;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === 'route.ts' ? [path] : [];
  });
}

/**
 * Routes that are public or retired on purpose. A new route is not on this list, so it fails this
 * test until it either checks who is calling or is added here with a reason.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  'health/route.ts': 'liveness probe, no data',
  'readiness/route.ts': 'database reachability only',
  'dev-login/route.ts': '404 unless local development bypass is on',
  'clerk/[[...path]]/route.ts': 'Clerk frontend API proxy',
  'auth/[...all]/route.ts': 'retired, always 404',
  'auth/mfa/setup/route.ts': 'retired, always 404',
  'auth/mfa/setup/verify/route.ts': 'retired, always 404',
  'invite/[token]/accept/route.ts': 'invitation token is the credential; rate limited',
  'invite/[token]/signup/route.ts': 'invitation token is the credential; rate limited',
  'cron/alert-digests/route.ts': 'CRON_SECRET bearer, constant-time compare',
};

// recordReportEvent and listRecentReportActivity resolve the caller's tenant authority themselves.
const AUTH_MARKERS =
  /requireAuthenticatedActor|recordReportEvent|listRecentReportActivity|FromRequest|resolveTenantExecutionContext|resolveCurrentContext|validateRequestedContext|readPersistedContext|withRequestAuthority|resolveTenantReadAuthority/;

describe('API route protection', () => {
  const files = routeFiles(API_ROOT).map((path) => ({
    key: path.slice(API_ROOT.length + 1),
    source: readFileSync(path, 'utf8'),
  }));

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('keeps every public-by-design entry pointing at a real route', () => {
    const keys = new Set(files.map((file) => file.key));
    for (const key of Object.keys(PUBLIC_BY_DESIGN)) expect(keys.has(key), key).toBe(true);
  });

  it.each(files.map((file) => [file.key, file.source] as const))(
    '%s checks who is calling, or is listed as public by design',
    (key, source) => {
      if (key in PUBLIC_BY_DESIGN) return;
      expect(AUTH_MARKERS.test(source), `${key} has no visible authentication call`).toBe(true);
    },
  );
});
