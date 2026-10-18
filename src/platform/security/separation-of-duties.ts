import { sql } from 'drizzle-orm';

type Executor = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

/**
 * Separation of duties with a solo-operator exception.
 *
 * The person who prepared a record may not approve it, unless nobody else could: no other active
 * member holds a role (tenant, legal-entity or station scope, unexpired) that grants the approval
 * permission at this station. A solo owner is therefore never locked out, and the moment a second
 * approver exists the block applies again.
 */
export function alternateApproverQuery(scope: {
  tenantId: string;
  stationId: string;
  excludeMembershipId: string;
  permission: string;
}) {
  return sql`
    select 1 as found
    from app.memberships m
    join app.membership_role_assignments a
      on a.tenant_id = m.tenant_id and a.membership_id = m.id
    join platform.role_permissions rp
      on rp.role_code = a.role_code and rp.permission_code = ${scope.permission}
    join app.stations s
      on s.tenant_id = m.tenant_id and s.id = ${scope.stationId}
    where m.tenant_id = ${scope.tenantId}
      and m.id <> ${scope.excludeMembershipId}
      and m.status = 'ACTIVE'
      and (a.expires_at is null or a.expires_at > now())
      and (
        a.scope_type = 'TENANT'
        or (a.scope_type = 'LEGAL_ENTITY' and a.legal_entity_id = s.legal_entity_id)
        or (a.scope_type = 'STATION' and a.station_id = s.id)
      )
    limit 1
  `;
}

export async function hasAlternateApprover(
  transaction: Executor,
  scope: Parameters<typeof alternateApproverQuery>[0],
): Promise<boolean> {
  const rows = (await transaction.execute(alternateApproverQuery(scope))) as Array<{
    found: number;
  }>;
  return rows.length > 0;
}
