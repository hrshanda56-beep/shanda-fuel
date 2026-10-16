import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';
import {
  resolveCurrentContext,
  resolveCurrentContextWithAuthority,
} from '../../src/modules/context/server';
import {
  loadTenantMembership,
  resolveTenantExecutionContext,
} from '../../src/modules/tenancy/server';
import { getServerShellAccess } from '../../src/design-system/navigation-server';
import { buildNavigationProjection } from '../../src/design-system/navigation-projection';
import { closeDatabase } from '../../src/platform/db';

// Fixtures require a separate disposable owner connection; application calls use
// DATABASE_URL (app_runtime). Never point either connection at a live service.
const fixtureUrl = process.env.DATABASE_FIXTURE_URL ?? process.env.DATABASE_URL;
if (!fixtureUrl)
  throw new Error(
    'A dedicated synthetic DATABASE_URL is required for context reuse integration tests',
  );
const scopes = [0, 1].map(() => ({
  tenant: randomUUID(),
  legal: randomUUID(),
  station: randomUUID(),
  actor: randomUUID(),
  membership: randomUUID(),
  session: randomUUID(),
  token: randomUUID(),
}));
let fixture: Sql;
const headersByActor: Headers[] = [];

async function originalProjection(request: Request) {
  // Original navigation-server path at 871dcd45: discover context, then resolve
  // selected tenant authority a second time. Keep identical production auth,
  // membership loading, RLS and projection code for the comparison.
  const resolution = await resolveCurrentContext(request);
  const current = resolution.current;
  if (!current) throw new Error('Synthetic context missing');
  const authority = await resolveTenantExecutionContext({
    request,
    requestedTenantId: current.organisationId,
  });
  const scope = current.stationId
    ? {
        tenantId: current.organisationId,
        scopeType: 'STATION' as const,
        legalEntityId: current.legalEntityId,
        stationId: current.stationId,
      }
    : current.legalEntityId
      ? {
          tenantId: current.organisationId,
          scopeType: 'LEGAL_ENTITY' as const,
          legalEntityId: current.legalEntityId,
        }
      : { tenantId: current.organisationId, scopeType: 'TENANT' as const };
  return {
    status: 'ready',
    current,
    projection: buildNavigationProjection({ actor: authority.authorization, scope }),
  };
}

function percentile(values: number[], fraction: number) {
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
}

describe('request-local context authority reuse', () => {
  beforeAll(async () => {
    fixture = postgres(fixtureUrl, { max: 1, prepare: false });
    for (const [index, scope] of scopes.entries()) {
      await fixture`insert into app.tenants (id,name,slug) values (${scope.tenant}, ${'Perf tenant ' + index}, ${'perf-' + scope.tenant})`;
      await fixture`insert into auth."user" (id,name,email) values (${scope.actor}, ${'Perf actor ' + index}, ${scope.actor + '@example.test'})`;
      await fixture`insert into app.memberships (id,tenant_id,identity_id,status) values (${scope.membership},${scope.tenant},${scope.actor},'ACTIVE')`;
      await fixture`insert into app.legal_entities (id,tenant_id,legal_name) values (${scope.legal},${scope.tenant},'Synthetic legal')`;
      await fixture`insert into app.stations (id,tenant_id,legal_entity_id,code,name,status) values (${scope.station},${scope.tenant},${scope.legal},'PERF','Synthetic station','ACTIVE')`;
      await fixture`insert into app.membership_role_assignments (tenant_id,membership_id,role_code,scope_type) values (${scope.tenant},${scope.membership},'OWNER','TENANT')`;
      await fixture`insert into auth.session (id,expires_at,token,user_id) values (${scope.session},${new Date(Date.now() + 3600000)},${scope.token},${scope.actor})`;
      const signed =
        scope.token + '.' + (await makeSignature(scope.token, process.env.BETTER_AUTH_SECRET!));
      headersByActor.push(
        new Headers({ host: '127.0.0.1:3198', cookie: 'shanda-fuel.session_token=' + signed }),
      );
    }
  });
  afterAll(async () => {
    await closeDatabase();
    await fixture?.end();
  });

  it('returns the same projection and scope as the original duplicate-read path', async () => {
    const original = await originalProjection(
      new Request('http://127.0.0.1:3198/', { headers: headersByActor[0] }),
    );
    const optimized = await getServerShellAccess(headersByActor[0]!);
    expect(optimized).toEqual(original);
    expect(optimized.status).toBe('ready');
    const publicContext = await resolveCurrentContext(
      new Request('http://127.0.0.1:3198/', { headers: headersByActor[0] }),
    );
    expect(publicContext).not.toHaveProperty('authority');
    expect(publicContext).not.toHaveProperty('authorities');
  });

  it('loads selected membership only once and keeps authority out of API context', async () => {
    let membershipReads = 0;
    const { resolution, authority } = await resolveCurrentContextWithAuthority(
      new Request('http://127.0.0.1:3198/', { headers: headersByActor[0] }),
      {
        dependencies: {
          loadMembership: async (identityId, tenantId) => {
            membershipReads++;
            return loadTenantMembership(identityId, tenantId);
          },
        },
      },
    );
    expect(membershipReads).toBe(1);
    expect(authority?.membership.tenantId).toBe(resolution.current?.organisationId);
    expect(authority?.actor.identityId).toBe(scopes[0]!.actor);
    expect(JSON.stringify(resolution)).not.toContain(scopes[0]!.session);
    expect(resolution).not.toHaveProperty('authority');
  });

  it('selects only the current actor tenant and rejects forged explicit context', async () => {
    for (const [index, headers] of headersByActor.entries()) {
      const result = await resolveCurrentContextWithAuthority(
        new Request('http://127.0.0.1:3198/', { headers }),
      );
      expect(result.authority?.membership.tenantId).toBe(scopes[index]!.tenant);
      expect(result.authority?.actor.identityId).toBe(scopes[index]!.actor);
      expect(result.resolution.available.organisations.map((org) => org.id)).toEqual([
        scopes[index]!.tenant,
      ]);
      await expect(
        resolveCurrentContextWithAuthority(
          new Request('http://127.0.0.1:3198/?tenantId=' + scopes[1 - index]!.tenant, { headers }),
        ),
      ).rejects.toThrow();
    }
  });

  it('refreshes authority on a new call after membership suspension and session expiry', async () => {
    const scope = scopes[1]!;
    expect((await getServerShellAccess(headersByActor[1]!)).status).toBe('ready');
    await fixture`update app.memberships set status='SUSPENDED' where id=${scope.membership}`;
    expect(await getServerShellAccess(headersByActor[1]!)).toEqual({ status: 'no-workplace' });
    await fixture`update app.memberships set status='ACTIVE' where id=${scope.membership}`;
    await fixture`update auth.session set expires_at=${new Date(Date.now() - 60000)} where id=${scope.session}`;
    expect(await getServerShellAccess(headersByActor[1]!)).toEqual({ status: 'signed-out' });
  });

  it('records optional alternating synthetic before/after benchmark without a timing assertion', async () => {
    if (process.env.PERF_BENCHMARK !== 'true') return;
    const headers = headersByActor[0]!;
    const before: number[] = [],
      after: number[] = [];
    const runBefore = () => originalProjection(new Request('http://127.0.0.1:3198/', { headers }));
    const runAfter = () => getServerShellAccess(headers);
    for (let n = 0; n < 5; n++) {
      await runBefore();
      await runAfter();
    }
    for (let n = 0; n < 40; n++) {
      const pair =
        n % 2
          ? ([
              [runAfter, after],
              [runBefore, before],
            ] as const)
          : ([
              [runBefore, before],
              [runAfter, after],
            ] as const);
      for (const [run, samples] of pair) {
        const start = performance.now();
        const result = await run();
        samples.push(performance.now() - start);
        expect(result.status).toBe('ready');
      }
    }
    console.info(
      'PERF_CONTEXT_REUSE',
      JSON.stringify({
        samples: 40,
        warmup: 5,
        before: { p50: percentile(before, 0.5), p95: percentile(before, 0.95) },
        after: { p50: percentile(after, 0.5), p95: percentile(after, 0.95) },
        beforeMs: before,
        afterMs: after,
      }),
    );
  }, 60000);
});
