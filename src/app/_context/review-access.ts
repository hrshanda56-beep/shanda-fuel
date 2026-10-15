import 'server-only';

import { headers } from 'next/headers';

import { requestFromHeaders } from '@/design-system/navigation-server';
import { resolveCurrentContext } from '@/modules/context/server';
import { resolveTenantExecutionContext } from '@/modules/tenancy/server';
import { isPermissionGranted } from '@/platform/security/permissions';

export type ReviewAccess = Readonly<{
  /** The signed-in person may approve or send back reconciliations at this station. */
  canApprove: boolean;
  /** Their membership, so the screen can tell whether they submitted the figures themselves. */
  membershipId: string | null;
}>;

/**
 * Whether the signed-in person may approve at this station, worked out the same way the server will
 * judge it. The approve and send-back buttons are only drawn when this says yes; the server still
 * checks again on every command.
 */
export async function getReviewAccess(tenantId: string, stationId: string): Promise<ReviewAccess> {
  try {
    const request = requestFromHeaders(await headers());
    if (!request) return { canApprove: false, membershipId: null };
    const resolution = await resolveCurrentContext(request);
    const legalEntityId = resolution.available.organisations
      .flatMap((organisation) => organisation.legalEntities)
      .find((entity) => entity.stations.some((station) => station.id === stationId))?.id;
    const authority = await resolveTenantExecutionContext({ request, requestedTenantId: tenantId });
    return {
      canApprove: isPermissionGranted({
        actor: authority.authorization,
        permissionCode: 'reconciliation.approve',
        requestedScope: { tenantId, scopeType: 'STATION', legalEntityId, stationId },
      }),
      membershipId: authority.membership.membershipId,
    };
  } catch {
    return { canApprove: false, membershipId: null };
  }
}
