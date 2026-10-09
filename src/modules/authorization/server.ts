import 'server-only';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { getDatabase } from '@/platform/db';
import { withTenantTransaction } from '@/platform/db/transaction';
import { AppError } from '@/platform/errors';
import { requireAuthenticatedActor, type AuthenticatedActorContext } from '@/modules/identity';
import {
  resolveTenantExecutionContext,
  type TenantExecutionContext,
} from '@/modules/tenancy/authority';
import { buildPermissionNavigationProjection, primaryRole, resolveLandingPath } from './workspaces';
import type { NavigationProjection } from '@/design-system/navigation';
import {
  isPermissionGranted,
  type AccessScope,
  type AuthorizationActor,
  type RoleCode,
} from '@/platform/security';

const TENANT_COOKIE = 'shanda-fuel-tenant-context';
const STATION_COOKIE = 'shanda-fuel-station-context';

export type AuthorizedStation = {
  tenantId: string;
  tenantName: string;
  legalEntityId: string;
  legalEntityName: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  timezone: string;
};

export type AuthorizedTenant = {
  tenantId: string;
  tenantName: string;
  authority: TenantExecutionContext;
  actor: AuthenticatedActorContext;
  stations: readonly AuthorizedStation[];
};

export type WebWorkspace = {
  actor: AuthenticatedActorContext;
  authorization: AuthorizationActor;
  tenant: AuthorizedTenant | null;
  station: AuthorizedStation | null;
  stations: readonly AuthorizedStation[];
  tenants: readonly AuthorizedTenant[];
  navigationProjection: readonly NavigationProjection[];
  role: RoleCode | undefined;
  landingPath: string;
  needsTenantSelection: boolean;
  needsStationSelection: boolean;
};

type TenantRow = { tenantId: string };
type StationRow = AuthorizedStation;

export async function requestFromServerComponents(path = '/'): Promise<Request> {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const host = requestHeaders.get('host') ?? 'localhost';
  return new Request(`${protocol}://${host}${path}`, { headers: requestHeaders });
}

async function currentContextCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

async function loadTenantRows(actorId: string): Promise<readonly TenantRow[]> {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    // This is the only pre-tenant lookup. RLS permits membership discovery
    // only for the authenticated identity; no browser value is trusted here.
    await transaction.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
    return transaction.execute<TenantRow>(sql`
      select m.tenant_id as "tenantId"
      from app.memberships m
      where m.identity_id = ${actorId}
        and m.status = 'ACTIVE'
      order by m.tenant_id
    `);
  });
}

async function loadTenantName(authority: TenantExecutionContext, tenantId: string) {
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{ name: string }>(sql`
      select name from app.tenants where id = ${tenantId} limit 1
    `),
  );
  return rows[0]?.name ?? 'Authorised organisation';
}

async function loadAuthorizedStations(
  authority: TenantExecutionContext,
  tenantId: string,
): Promise<readonly AuthorizedStation[]> {
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<StationRow>(sql`
      select s.tenant_id as "tenantId",
             t.name as "tenantName",
             s.legal_entity_id as "legalEntityId",
             le.legal_name as "legalEntityName",
             s.id as "stationId",
             s.code as "stationCode",
             s.name as "stationName",
             s.timezone
      from app.stations s
      join app.tenants t on t.id = s.tenant_id
      join app.legal_entities le on le.tenant_id = s.tenant_id and le.id = s.legal_entity_id
      where s.tenant_id = ${tenantId}
        and s.status <> 'ARCHIVED'
      order by s.name, s.id
    `),
  );

  return rows.filter((station) => {
    const scope: AccessScope = {
      tenantId,
      scopeType: 'STATION',
      legalEntityId: station.legalEntityId,
      stationId: station.stationId,
    };
    // station.view is checked against live role/grant authority, not a role
    // label and not the fact that the row exists in the tenant.
    return isPermissionGranted({
      actor: authority.authorization,
      permissionCode: 'station.view',
      requestedScope: scope,
    });
  });
}

export function scopesForWorkspace(
  authorization: AuthorizationActor,
  station: AuthorizedStation | null,
): readonly AccessScope[] {
  if (station) {
    return [
      {
        tenantId: station.tenantId,
        scopeType: 'STATION',
        legalEntityId: station.legalEntityId,
        stationId: station.stationId,
      },
      {
        tenantId: station.tenantId,
        scopeType: 'LEGAL_ENTITY',
        legalEntityId: station.legalEntityId,
      },
      { tenantId: station.tenantId, scopeType: 'TENANT' },
    ];
  }
  return authorization.roleAssignments.map(({ tenantId, scopeType, legalEntityId, stationId }) => ({
    tenantId,
    scopeType,
    ...(legalEntityId ? { legalEntityId } : {}),
    ...(stationId ? { stationId } : {}),
  }));
}

export function assertWorkspacePermission(
  workspace: Pick<WebWorkspace, 'authorization' | 'station'>,
  permissionCode: Parameters<typeof isPermissionGranted>[0]['permissionCode'],
): void {
  const scopes = scopesForWorkspace(workspace.authorization, workspace.station);
  if (
    !scopes.some((requestedScope) =>
      isPermissionGranted({
        actor: workspace.authorization,
        permissionCode,
        requestedScope,
      }),
    )
  ) {
    throw new AppError('FORBIDDEN', 'The actor is not authorized for this workspace');
  }
}

function selectedTenant(
  tenants: readonly AuthorizedTenant[],
  requestedTenantId: string | undefined,
  rememberedTenantId: string | undefined,
): AuthorizedTenant | null {
  const id = requestedTenantId ?? rememberedTenantId;
  if (id) return tenants.find((tenant) => tenant.tenantId === id) ?? null;
  return tenants.length === 1 ? tenants[0]! : null;
}

export async function resolveWebWorkspace(input: {
  request: Request;
  requestedTenantId?: string;
  requestedStationId?: string;
  requireStation?: boolean;
}): Promise<WebWorkspace> {
  let actor: AuthenticatedActorContext;
  try {
    actor = await requireAuthenticatedActor(input.request);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') {
      const pathname = new URL(input.request.url).pathname;
      redirect(`/login?next=${encodeURIComponent(pathname)}`);
    }
    throw error;
  }
  const tenantRows = await loadTenantRows(actor.identityId);
  if (tenantRows.length === 0) {
    throw new AppError('FORBIDDEN', 'The actor has no active tenant membership');
  }

  const tenantResults: AuthorizedTenant[] = [];
  for (const row of tenantRows) {
    const authority = await resolveTenantExecutionContext({
      request: input.request,
      requestedTenantId: row.tenantId,
      resolveActor: async () => actor,
    });
    const stations = await loadAuthorizedStations(authority, row.tenantId);
    const tenantName = await loadTenantName(authority, row.tenantId);
    tenantResults.push({
      tenantId: row.tenantId,
      tenantName,
      authority,
      actor,
      stations,
    });
  }

  const tenant = selectedTenant(
    tenantResults,
    input.requestedTenantId,
    await currentContextCookie(TENANT_COOKIE),
  );
  if (input.requestedTenantId && !tenant) {
    throw new AppError('FORBIDDEN', 'The actor is not authorized for the requested tenant');
  }

  const authorization =
    tenant?.authority.authorization ?? tenantResults[0]!.authority.authorization;
  const allStations = tenantResults.flatMap((item) => item.stations);
  const stationCandidates = tenant?.stations ?? allStations;
  const rememberedStationId = await currentContextCookie(STATION_COOKIE);
  const requestedStationId = input.requestedStationId ?? rememberedStationId;
  const station = requestedStationId
    ? (stationCandidates.find((item) => item.stationId === requestedStationId) ?? null)
    : stationCandidates.length === 1
      ? stationCandidates[0]!
      : null;

  if (input.requestedStationId && !station) {
    throw new AppError('FORBIDDEN', 'The actor is not authorized for the requested station');
  }

  const scopes = scopesForWorkspace(authorization, station);
  const navigationProjection = buildPermissionNavigationProjection({
    actor: authorization,
    scopes,
  });
  const landingPath = resolveLandingPath({ actor: authorization, scopes });

  return {
    actor,
    authorization,
    tenant,
    station,
    stations: stationCandidates,
    tenants: tenantResults,
    navigationProjection,
    role: primaryRole(authorization),
    landingPath,
    needsTenantSelection: tenant === null,
    needsStationSelection: Boolean(input.requireStation && !station),
  };
}

export function workspaceRoleLabel(role: RoleCode | undefined): string {
  switch (role) {
    case 'ATTENDANT':
      return 'Attendant';
    case 'SUPERVISOR':
      return 'Supervisor';
    case 'FINANCE':
      return 'Finance';
    case 'ADMINISTRATOR':
      return 'Administrator';
    case 'OWNER':
      return 'Owner';
    default:
      return 'Shanda Fuel';
  }
}
