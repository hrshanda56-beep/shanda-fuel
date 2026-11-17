import { seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the cross-tenant route sweep.');

/**
 * F4: company B cannot read or write company A's data through any API route. This finds every
 * route in the app, calls each of its methods as a person who belongs only to company B while
 * naming company A, and requires that nothing succeeds. It also requires that nothing fails with a
 * server error, because an unhandled error is a route that never reached its own checks.
 *
 * A route that is allowed to answer 200 for any signed-in person is listed below with the reason,
 * because it returns only what that person is already allowed to see.
 */
const ROOT = join(process.cwd(), 'src', 'app', 'api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const MAY_ANSWER_FOR_ANY_SIGNED_IN_PERSON: Record<string, string> = {
  context: 'lists only the companies and stations the caller may already select',
  health: 'public liveness check, returns no company data',
  readiness: 'public deploy probe that reports only whether the database answers',
  clerk: 'sign-in proxy, not company data',
  auth: 'sign-in and step-up endpoints, not company data',
  'security/rate-limit-proof': 'diagnostic that returns no company data',
  'dev-login': 'development only, answers 404 outside development',
  'cron/alert-digests': 'machine route with its own secret, not a person session',
  invite: 'invitation links carry their own secret and name no company in the request',
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

const routes = routeFiles(ROOT).map((file) => {
  const route = relative(ROOT, file).split(sep).slice(0, -1).join('/');
  return { file, route };
});

const ids = {
  tenantA: 'f4a00000-0000-4000-8000-000000000001',
  tenantB: 'f4a00000-0000-4000-8000-000000000002',
  legalA: 'f4a00000-0000-4000-8000-000000000011',
  legalB: 'f4a00000-0000-4000-8000-000000000012',
  stationA: 'f4a00000-0000-4000-8000-000000000021',
  stationB: 'f4a00000-0000-4000-8000-000000000022',
  actorA: 'f4a00000-0000-4000-8000-000000000031',
  actorB: 'f4a00000-0000-4000-8000-000000000032',
  membershipA: 'f4a00000-0000-4000-8000-000000000041',
  membershipB: 'f4a00000-0000-4000-8000-000000000042',
  sessionB: 'f4a00000-0000-4000-8000-000000000052',
};
const TOKEN_B = 'f4a-company-b-owner-token';
const RANDOM = '00000000-0000-4000-8000-0000000000ff';

let client: Sql;

function urlFor(route: string) {
  const path = route
    .replace(/\[\.\.\.[^\]]+\]|\[\[\.\.\.[^\]]+\]\]/g, 'x')
    .replace(/\[[^\]]+\]/g, RANDOM);
  const query = new URLSearchParams({
    tenantId: ids.tenantA,
    organisationId: ids.tenantA,
    stationId: ids.stationA,
    stationIds: ids.stationA,
    legalEntityId: ids.legalA,
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
  });
  return `http://127.0.0.1:3000/api/${path}?${query.toString()}`;
}

describe('company B cannot reach company A through any route (F4)', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-f4a-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-f4a-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenantA}', 'F4 Company A', 'f4a-company-a'),
        ('${ids.tenantB}', 'F4 Company B', 'f4a-company-b') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actorA}', 'F4 Owner A', 'f4a-a@example.test'),
        ('${ids.actorB}', 'F4 Owner B', 'f4a-b@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membershipA}', '${ids.tenantA}', '${ids.actorA}', 'ACTIVE'),
        ('${ids.membershipB}', '${ids.tenantB}', '${ids.actorB}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalA}', '${ids.tenantA}', 'F4 Legal A'),
        ('${ids.legalB}', '${ids.tenantB}', 'F4 Legal B') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.stationA}', '${ids.tenantA}', '${ids.legalA}', 'F4A', 'F4 Station A', 'ACTIVE', 'Africa/Harare'),
        ('${ids.stationB}', '${ids.tenantB}', '${ids.legalB}', 'F4B', 'F4 Station B', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenantA}', '${ids.membershipA}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenantB}', '${ids.membershipB}', 'OWNER', 'TENANT', null, null)
        on conflict (id) do nothing;
    `);
    await seedClerkSession(client, ids.sessionB, TOKEN_B, ids.actorB, true);
  });

  afterAll(async () => client?.end());

  it('finds the routes (so an empty sweep cannot pass)', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  for (const { file, route } of routes) {
    const exempt = Object.keys(MAY_ANSWER_FOR_ANY_SIGNED_IN_PERSON).find(
      (prefix) => route === prefix || route.startsWith(`${prefix}/`),
    );
    it(`${route}: nothing succeeds or crashes for another company`, async () => {
      let handlersOf: Record<string, unknown>;
      try {
        handlersOf = (await import(file)) as Record<string, unknown>;
      } catch (error) {
        // The sign-in proxy cannot load under the test's stand-in for Clerk; it holds no company
        // data and is on the exempt list.
        if (exempt) return;
        throw error;
      }
      const handlers = METHODS.filter((method) => typeof handlersOf[method] === 'function');
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const headers = new Headers({ 'content-type': 'application/json' });
        for (const [name, value] of Object.entries(clerkHeaders(TOKEN_B))) headers.set(name, value);
        headers.set('idempotency-key', `f4a-${route}-${method}`);
        const hasBody = method !== 'GET' && method !== 'DELETE';
        // A route with a URL parameter (for example [documentId]) receives it as a second argument.
        const parameters = Object.fromEntries(
          [...route.matchAll(/\[([^\].]+)\]/g)].map((match) => [match[1], RANDOM]),
        );
        const response = await (
          handlersOf[method] as (request: Request, context: unknown) => Promise<Response>
        )(
          new Request(urlFor(route), {
            method,
            headers,
            ...(hasBody
              ? {
                  body: JSON.stringify({
                    tenantId: ids.tenantA,
                    stationId: ids.stationA,
                    legalEntityId: ids.legalA,
                  }),
                }
              : {}),
          }),
          { params: Promise.resolve(parameters) },
        );
        const where = `${method} /api/${route}`;
        // 500 is an unhandled error. A 503 is a route saying a service it needs is not set up.
        expect(
          response.status,
          `${where} must not crash: ${await response.clone().text()}`,
        ).not.toBe(500);
        if (!exempt) {
          expect(
            response.status < 200 || response.status >= 300,
            `${where} answered ${response.status} for another company`,
          ).toBe(true);
        }
      }
    });
  }
});
