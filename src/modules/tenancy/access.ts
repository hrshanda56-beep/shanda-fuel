import { AppError } from '../../platform/errors';
import type { TenantTransactionContext } from '../../platform/db';

export type ActiveMembership = {
  tenantId: string;
  membershipId: string;
  actorId: string;
  status: MembershipStatus;
};

export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'DISABLED';

/**
 * Must run after Better Auth session resolution and before opening business
 * queries. Database RLS remains the second, independent enforcement layer.
 */
export function assertActiveTenantMembership(
  context: TenantTransactionContext,
  membership: ActiveMembership,
): void {
  if (
    membership.status !== 'ACTIVE' ||
    membership.tenantId !== context.tenantId ||
    membership.membershipId !== context.membershipId ||
    membership.actorId !== context.actorId
  ) {
    throw new AppError('FORBIDDEN', 'The actor does not have an active membership in this tenant');
  }
}
