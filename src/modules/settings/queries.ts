import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  findLegalEntity,
  findOrganisation,
  findStation,
  type AvailableContext,
  type ContextResolution,
} from '../context';
import { resolveCurrentContext } from '../context/server';
import { resolveAuthenticatedActor } from '../identity';
import { getDatabase } from '../../platform/db';
import { AppError } from '../../platform/errors';
import { authorize } from '../../platform/security';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/server';
import { resolveStaffOverview } from '../staff';

import type { SettingsAccount, SettingsView } from './contracts';

const sessionSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    email: z.string().email().nullable(),
  }),
  session: z.object({
    userId: z.string().uuid(),
  }),
});

export type SettingsSessionReader = Readonly<{
  api: Readonly<{
    getSession: (input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean };
    }) => Promise<unknown>;
  }>;
}>;

export type SettingsDependencies = Readonly<{
  readSession?: (request: Request) => Promise<unknown>;
  resolveContext?: (request: Request) => Promise<ContextResolution>;
  resolveAuthority?: (input: {
    request: Request;
    requestedTenantId: string;
    now?: Date;
  }) => Promise<TenantExecutionContext>;
  now?: Date;
}>;

async function readAccount(
  request: Request,
  readSession: (request: Request) => Promise<unknown>,
): Promise<SettingsAccount> {
  const result = await readSession(request);
  const parsed = sessionSchema.safeParse(result);
  if (!parsed.success || parsed.data.user.id !== parsed.data.session.userId) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }

  return {
    name: parsed.data.user.name,
    email: parsed.data.user.email,
  };
}

function buildStation(
  available: AvailableContext,
  organisationId: string,
  legalEntityId: string | undefined,
  stationId: string | undefined,
) {
  if (!stationId) return null;

  const organisation = findOrganisation(available, organisationId);
  if (!organisation) throw new AppError('FORBIDDEN', 'The selected organisation is not authorised');

  const stationMatch = findStation(organisation, stationId);
  if (!stationMatch) throw new AppError('FORBIDDEN', 'The selected station is not authorised');
  if (legalEntityId && stationMatch.legalEntity.id !== legalEntityId) {
    throw new AppError('FORBIDDEN', 'The selected station is not authorised for this legal entity');
  }

  return {
    id: stationMatch.station.id,
    code: stationMatch.station.code,
    name: stationMatch.station.name,
    timezone: stationMatch.station.timezone,
  };
}

/**
 * Convert the canonical authorised Context tree into the narrow Settings DTO.
 * This function deliberately accepts no client-selected IDs; the selection has
 * already been revalidated by the Context contract.
 */
export function buildSettingsView(
  account: SettingsAccount,
  resolution: ContextResolution,
  staff?: SettingsView['staff'],
): SettingsView {
  const current = resolution.current;
  if (!current) {
    return {
      account,
      context: {
        status: 'unavailable',
        legalEntities: [],
        selectedStation: null,
      },
      ...(staff ? { staff } : {}),
    };
  }

  const organisation = findOrganisation(resolution.available, current.organisationId);
  if (!organisation) {
    throw new AppError('FORBIDDEN', 'The selected organisation is not authorised');
  }

  if (current.legalEntityId && !findLegalEntity(organisation, current.legalEntityId)) {
    throw new AppError('FORBIDDEN', 'The selected legal entity is not authorised');
  }

  return {
    account,
    context: {
      status: 'ready',
      organisation: { id: organisation.id, name: organisation.name },
      legalEntities: organisation.legalEntities.map((legalEntity) => ({
        id: legalEntity.id,
        name: legalEntity.name,
      })),
      selectedStation: buildStation(
        resolution.available,
        organisation.id,
        current.legalEntityId,
        current.stationId,
      ),
    },
    ...(staff ? { staff } : {}),
  };
}

/** Resolve real account and authorised organisation hierarchy for Settings. */
export async function resolveSettings(
  request: Request,
  dependencies: SettingsDependencies = {},
): Promise<SettingsView> {
  const readSession =
    dependencies.readSession ??
    (async (currentRequest: Request) => {
      const actor = await resolveAuthenticatedActor(currentRequest);
      if (!actor) return null;
      const rows = await getDatabase().execute<{ name: string; email: string | null }>(sql`
        select name, email
        from auth."user"
        where id = ${actor.identityId}
        limit 1
      `);
      const account = rows[0];
      if (!account) throw new AppError('UNAUTHENTICATED', 'Authentication identity is unavailable');
      return {
        user: { id: actor.identityId, name: account.name, email: account.email },
        session: { userId: actor.identityId },
      };
    });
  const account = await readAccount(request, readSession);
  const resolution = await (dependencies.resolveContext ?? resolveCurrentContext)(request);

  if (resolution.current) {
    const authority = await (dependencies.resolveAuthority ?? resolveTenantExecutionContext)({
      request,
      requestedTenantId: resolution.current.organisationId,
      now: dependencies.now,
    });
    authorize({
      actor: authority.authorization,
      permissionCode: 'tenant.view',
      requestedScope: {
        tenantId: resolution.current.organisationId,
        scopeType: 'TENANT',
      },
      now: dependencies.now,
    });
    const staff = await resolveStaffOverview(authority, { now: dependencies.now });
    return buildSettingsView(account, resolution, staff);
  }

  return buildSettingsView(account, resolution);
}
