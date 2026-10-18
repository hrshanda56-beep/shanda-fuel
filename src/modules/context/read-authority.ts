import 'server-only';
import { requireAuthenticatedActor, type AuthenticatedActorContext } from '../identity';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import { readNavigationSnapshot, decodeNavigationSnapshot } from './navigation-snapshot';

/** Fresh authority for a single API read; never reused across HTTP requests. */
export async function resolveStationReadAuthority(input: {
  request: Request;
  tenantId: string;
  stationId: string;
  authenticatedActor?: AuthenticatedActorContext;
}) {
  const actor = input.authenticatedActor ?? (await requireAuthenticatedActor(input.request));
  const consolidated = process.env.CONSOLIDATED_CONTEXT_READS === '1';
  let snapshot: Awaited<ReturnType<typeof readNavigationSnapshot>> = [];
  // The resolver validates tenant and actor bindings before creating trusted context.
  const authority = await resolveTenantExecutionContext({
    request: input.request,
    requestedTenantId: input.tenantId,
    authenticatedActor: actor,
    ...(consolidated
      ? {
          loadMembership: async (identityId: string, tenantId: string) => {
            snapshot = actor.navigationSnapshot
              ? decodeNavigationSnapshot(actor.navigationSnapshot, identityId)
              : await readNavigationSnapshot(identityId);
            return (
              snapshot.find((item) => item.membership.tenantId === tenantId)?.membership ?? null
            );
          },
        }
      : {}),
  });
  const row = snapshot
    .find((item) => item.membership.tenantId === input.tenantId)
    ?.rows.find((row) => row.station_id === input.stationId && row.legal_entity_id !== null);
  // Inactive stations are absent from the picker snapshot. Preserve historical
  // read behavior by falling back to the original RLS station query for those.
  const station =
    row && row.station_id && row.legal_entity_id
      ? {
          id: row.station_id,
          tenantId: input.tenantId,
          legalEntityId: row.legal_entity_id,
          timezone: row.station_timezone,
        }
      : undefined;
  return { authority, station };
}
