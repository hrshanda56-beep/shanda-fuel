import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { getDatabase, type Database } from '../../platform/db';
import { withTenantTransaction } from '../../platform/db/transaction';
import { isPermissionGranted } from '../../platform/security/permissions';
import {
  requireAuthenticatedActor,
  type AuthenticatedActorContext,
  type AuthenticatedActorResolver,
} from '../identity';
import {
  loadTenantMembership,
  resolveTenantExecutionContext,
  type MembershipRecord,
  type TenantExecutionContext,
  type TenantMembershipLoader,
} from '../tenancy/server';
import type {
  AvailableContext,
  ContextLegalEntity,
  ContextOrganisation,
  ContextResolution,
  ContextSelection,
} from './contracts';
import { defaultContextSelection, invalidContext, validateContextSelection } from './domain';
import { readPersistedContext } from './persistence';
import {
  contextRoutePolicy,
  readContextRoute,
  type ContextRoute,
  type ContextRoutePolicy,
} from './routes';

type ContextTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type TenantIdRow = { tenant_id: string };
type ContextRow = {
  organisation_id: string;
  organisation_name: string;
  legal_entity_id: string | null;
  legal_entity_name: string | null;
  station_id: string | null;
  station_code: string | null;
  station_name: string | null;
  station_timezone: string | null;
};

export type AuthorizedContextRow = ContextRow;

type QueryDependencies = Readonly<{
  database?: Pick<Database, 'transaction'>;
  resolveActor?: AuthenticatedActorResolver;
  loadMembership?: TenantMembershipLoader;
  now?: Date;
}>;

/**
 * Load active memberships without choosing a tenant. This is the one
 * intentional pre-tenant lookup; RLS permits it only for the authenticated
 * actor, and all subsequent reads run under a tenant transaction context.
 */
async function listActiveTenantIds(
  identityId: string,
  database: Pick<Database, 'transaction'>,
): Promise<string[]> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.actor_id', ${identityId}, true)`);
    const rows = await transaction.execute<TenantIdRow>(sql`
      select tenant_id
      from app.memberships
      where identity_id = ${identityId}
        and status = 'ACTIVE'
      order by tenant_id
    `);
    return [...new Set(rows.map((row) => row.tenant_id))];
  });
}

async function readTenantRows(authority: TenantExecutionContext): Promise<ContextRow[]> {
  return withTenantTransaction(authority.transaction, async (transaction: ContextTransaction) => {
    return transaction.execute<ContextRow>(sql`
      select
        t.id as organisation_id,
        t.name as organisation_name,
        le.id as legal_entity_id,
        le.legal_name as legal_entity_name,
        s.id as station_id,
        s.code as station_code,
        s.name as station_name,
        s.timezone as station_timezone
      from app.tenants t
      left join app.legal_entities le
        on le.tenant_id = t.id
       and le.status = 'ACTIVE'
      left join app.stations s
        on s.tenant_id = le.tenant_id
       and s.legal_entity_id = le.id
       and s.status = 'ACTIVE'
      where t.id = ${authority.membership.tenantId}
        and t.status = 'ACTIVE'
      order by le.legal_name, le.id, s.code, s.id
    `);
  });
}

function hasPermission(
  authority: TenantExecutionContext,
  permissionCode: 'tenant.context.select' | 'legal_entity.view' | 'station.view',
  scope: {
    tenantId: string;
    scopeType: 'TENANT' | 'LEGAL_ENTITY' | 'STATION';
    legalEntityId?: string;
    stationId?: string;
  },
  now: Date,
): boolean {
  return isPermissionGranted({
    actor: authority.authorization,
    permissionCode,
    requestedScope: scope,
    now,
  });
}

/**
 * Apply live authorization to rows already read under RLS. Keeping this
 * filter separate makes it difficult for a future query change to accidentally
 * turn a tenant-wide read into a scope-wide disclosure.
 */
export function filterAuthorizedContextRows(
  authority: TenantExecutionContext,
  rows: readonly ContextRow[],
  now = new Date(),
): AvailableContext {
  const organisations = new Map<string, ContextOrganisation>();
  const legalEntities = new Map<string, ContextLegalEntity>();

  for (const row of rows) {
    if (!row.legal_entity_id || !row.legal_entity_name) continue;
    const legalScope = {
      tenantId: row.organisation_id,
      scopeType: 'LEGAL_ENTITY' as const,
      legalEntityId: row.legal_entity_id,
    };
    const legalContextSelectable =
      hasPermission(authority, 'tenant.context.select', legalScope, now) &&
      hasPermission(authority, 'legal_entity.view', legalScope, now);
    const stationScope = row.station_id
      ? {
          tenantId: row.organisation_id,
          scopeType: 'STATION' as const,
          legalEntityId: row.legal_entity_id,
          stationId: row.station_id,
        }
      : undefined;
    const stationContextSelectable = stationScope
      ? hasPermission(authority, 'tenant.context.select', stationScope, now) &&
        hasPermission(authority, 'station.view', stationScope, now)
      : false;

    if (!legalContextSelectable && !stationContextSelectable) continue;

    let organisation = organisations.get(row.organisation_id);
    if (!organisation) {
      organisation = {
        id: row.organisation_id,
        name: row.organisation_name,
        legalEntities: [],
      };
      organisations.set(row.organisation_id, organisation);
    }

    let legalEntity = legalEntities.get(row.legal_entity_id);
    if (!legalEntity) {
      legalEntity = {
        id: row.legal_entity_id,
        name: row.legal_entity_name,
        stations: [],
      };
      legalEntities.set(row.legal_entity_id, legalEntity);
      (organisation.legalEntities as ContextLegalEntity[]).push(legalEntity);
    }

    if (
      stationContextSelectable &&
      row.station_id &&
      row.station_code &&
      row.station_name &&
      row.station_timezone
    ) {
      (legalEntity.stations as Array<ContextLegalEntity['stations'][number]>).push({
        id: row.station_id,
        code: row.station_code,
        name: row.station_name,
        timezone: row.station_timezone,
      });
    }
  }

  // Do not expose an organisation that only became visible through an
  // unauthorized empty legal-entity row.
  return {
    organisations: [...organisations.values()].filter(
      (organisation) => organisation.legalEntities.length > 0,
    ),
  };
}

/** Discover only the context tree the current authenticated actor may use. */
async function discoverContextAuthority(
  request: Request,
  dependencies: QueryDependencies = {},
): Promise<{ available: AvailableContext; authorities: Map<string, TenantExecutionContext> }> {
  const now = dependencies.now ?? new Date();
  const actor = await requireAuthenticatedActor(request, dependencies.resolveActor, now);
  const database = dependencies.database ?? getDatabase();
  const tenantIds = await listActiveTenantIds(actor.identityId, database);
  const membershipLoader = dependencies.loadMembership ?? loadTenantMembership;
  const organisations: ContextOrganisation[] = [];
  const authorities = new Map<string, TenantExecutionContext>();

  for (const tenantId of tenantIds) {
    const membership = await membershipLoader(actor.identityId, tenantId);
    if (!membership || membership.status !== 'ACTIVE') continue;
    const authority = await resolveTenantExecutionContext({
      request,
      requestedTenantId: tenantId,
      resolveActor: async () => actor,
      loadMembership: async () => membership,
      now,
    });
    const rows = await readTenantRows(authority);
    const authorized = filterAuthorizedContextRows(authority, rows, now);
    organisations.push(...authorized.organisations);
    authorities.set(tenantId, authority);
  }

  return { available: { organisations }, authorities };
}

export async function discoverAvailableContext(
  request: Request,
  dependencies: QueryDependencies = {},
): Promise<AvailableContext> {
  return (await discoverContextAuthority(request, dependencies)).available;
}

function routeSelection(available: AvailableContext, route: ContextRoute): ContextSelection | null {
  if (
    !route.hasExplicitOrganisation &&
    !route.hasExplicitLegalEntity &&
    !route.hasExplicitStation &&
    !route.hasExplicitAllStations
  ) {
    return null;
  }

  if (route.organisationId) {
    return {
      organisationId: route.organisationId,
      ...(route.legalEntityId ? { legalEntityId: route.legalEntityId } : {}),
      ...(route.stationId ? { stationId: route.stationId } : {}),
      allStations: route.allStations,
    };
  }

  const matches = available.organisations.flatMap((organisation) =>
    organisation.legalEntities.flatMap((legalEntity) => {
      const legalMatches = route.legalEntityId ? legalEntity.id === route.legalEntityId : true;
      const stationMatches = route.stationId
        ? legalEntity.stations.some((station) => station.id === route.stationId)
        : true;
      return legalMatches && stationMatches ? [{ organisation, legalEntity }] : [];
    }),
  );
  if (matches.length !== 1) throw invalidContext('route context');
  const match = matches[0]!;
  return {
    organisationId: match.organisation.id,
    ...(route.legalEntityId || route.stationId ? { legalEntityId: match.legalEntity.id } : {}),
    ...(route.stationId ? { stationId: route.stationId } : {}),
    allStations: route.allStations,
  };
}

function validatePersistedSelection(
  available: AvailableContext,
  persisted: ContextSelection,
  policy: ContextRoutePolicy,
): ContextSelection | null {
  try {
    return validateContextSelection(available, persisted, policy);
  } catch {
    return null;
  }
}

/** Reuse only the authority verified during this call; never cache between requests. */
export async function resolveCurrentContextWithAuthority(
  request: Request,
  input: Readonly<{
    route?: ContextRoute;
    policy?: ContextRoutePolicy;
    dependencies?: QueryDependencies;
  }> = {},
): Promise<{ resolution: ContextResolution; authority: TenantExecutionContext | null }> {
  const url = new URL(request.url);
  const route = input.route ?? readContextRoute(url.pathname, url.searchParams);
  const policy = input.policy ?? contextRoutePolicy(route.pathname);
  const { available, authorities } = await discoverContextAuthority(request, input.dependencies);
  const persisted = readPersistedContext(request);

  const explicit = routeSelection(available, route);
  let current: ContextSelection | null = null;
  let persistedSelectionInvalid = false;
  if (explicit) {
    current = validateContextSelection(available, explicit, policy);
  } else if (persisted.selection) {
    current = validatePersistedSelection(available, persisted.selection, policy);
    persistedSelectionInvalid = current === null;
  }
  current ??= defaultContextSelection(available, policy);

  return {
    resolution: {
      available,
      current,
      route: { pathname: route.pathname, policy },
      persistedContextInvalid: persisted.invalid || persistedSelectionInvalid,
    },
    authority: current ? (authorities.get(current.organisationId) ?? null) : null,
  };
}

/** Keep authority server-only; public context responses contain selection data only. */
export async function resolveCurrentContext(
  request: Request,
  input: Parameters<typeof resolveCurrentContextWithAuthority>[1] = {},
): Promise<ContextResolution> {
  return (await resolveCurrentContextWithAuthority(request, input)).resolution;
}

export async function validateRequestedContext(
  request: Request,
  selection: ContextSelection,
  input: Readonly<{
    pathname?: string;
    policy?: ContextRoutePolicy;
    dependencies?: QueryDependencies;
  }> = {},
): Promise<ContextSelection> {
  const pathname = input.pathname ?? new URL(request.url).pathname;
  const policy = input.policy ?? contextRoutePolicy(pathname);
  const available = await discoverAvailableContext(request, input.dependencies);
  return validateContextSelection(available, selection, policy);
}

export type { QueryDependencies };
