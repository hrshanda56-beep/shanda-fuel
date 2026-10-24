import 'server-only';

import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import type { CustomerCommandContext, CustomerTransaction } from './application';

/**
 * Owner default: only an owner or an administrator can approve an exception on a customer
 * account. Nobody but an owner approves their own entry, so a supervisor cannot sign off a
 * request they made themselves.
 */
export async function assertApproverAllowed(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  approverMembershipId: string,
): Promise<void> {
  const rows = await transaction.execute<{ role_code: string }>(sql`
    select distinct r.role_code
    from app.memberships m
    join app.membership_role_assignments r
      on r.tenant_id = m.tenant_id and r.membership_id = m.id
    where m.tenant_id = ${context.tenantId} and m.id = ${approverMembershipId}
      and m.status = 'ACTIVE' and r.role_code in ('OWNER', 'ADMINISTRATOR')
  `);
  if (rows.length === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Only an owner or an administrator can approve this. Choose one of them.',
    );
  }
  const isOwner = rows.some((row) => row.role_code === 'OWNER');
  if (!isOwner && approverMembershipId === context.authority.membership.membershipId) {
    throw new AppError('VALIDATION_FAILED', 'You cannot approve your own entry. Ask someone else.');
  }
}
