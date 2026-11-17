import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorizeCustomerCommand } from './application';
import { resolveCustomerReadContext } from './read-context';
import type { StaffPickerOption } from './staff-picker-options';

const querySchema = z.object({ tenantId: z.string().uuid() });

/**
 * Active staff who are not yet on a staff fuel benefit, for the picker on the benefit page. Same
 * permission as the page itself, and only name and email are returned (no roles or assignments).
 */
export async function getStaffBenefitStaffOptionsFromRequest(
  request: Request,
  input: unknown,
): Promise<readonly StaffPickerOption[]> {
  const query = querySchema.parse(input);
  const context = await resolveCustomerReadContext({ request, requestedTenantId: query.tenantId });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      membership_id: string;
      name: string;
      email: string;
    }>(sql`
      select m.id as membership_id,
             coalesce(nullif(trim(u.name), ''), u.email) as name,
             u.email
      from app.memberships m
      join app.users u on u.id = m.identity_id
      where m.tenant_id = ${context.tenantId}
        and m.status = 'ACTIVE'
        and not exists (
          select 1 from app.customer_staff_benefit_terms t
          where t.tenant_id = m.tenant_id and t.staff_membership_id = m.id
        )
      order by 2, u.email
    `);
    return rows.map((row) => ({
      membershipId: row.membership_id,
      name: row.name,
      email: row.email,
    }));
  });
}
