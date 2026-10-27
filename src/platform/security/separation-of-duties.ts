import { sql } from 'drizzle-orm';

type Executor = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

/**
 * Separation of duties with an owner exception.
 *
 * The person who prepared a record may not approve it, unless they are the only active owner at
 * the station: the owner is the last resort and is never locked out. With two active owners each
 * needs the other; finance and administrators need another approver or an owner; supervisors and
 * attendants never approve their own and are never counted as the "someone else". The approval
 * permission itself is checked separately, so this only decides whether self-approval is allowed.
 */
export function alternateApproverQuery(scope: {
  tenantId: string;
  stationId: string;
  excludeMembershipId: string;
}) {
  return sql`
    select 1 as found
    from (${soleOwnerQuery({
      tenantId: scope.tenantId,
      stationId: scope.stationId,
      membershipId: scope.excludeMembershipId,
    })}) o
    where not (coalesce(o.is_owner, false) and not coalesce(o.has_other_owner, false))
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

/** Whether the member is an active owner at the station and no other active owner exists. */
export function soleOwnerQuery(scope: {
  tenantId: string;
  stationId: string;
  membershipId: string;
}) {
  return sql`
    select
      bool_or(m.id = ${scope.membershipId}) as is_owner,
      bool_or(m.id <> ${scope.membershipId}) as has_other_owner
    from app.memberships m
    join app.membership_role_assignments a
      on a.tenant_id = m.tenant_id and a.membership_id = m.id and a.role_code = 'OWNER'
    join app.stations s
      on s.tenant_id = m.tenant_id and s.id = ${scope.stationId}
    where m.tenant_id = ${scope.tenantId}
      and m.status = 'ACTIVE'
      and (a.expires_at is null or a.expires_at > now())
      and (
        a.scope_type = 'TENANT'
        or (a.scope_type = 'LEGAL_ENTITY' and a.legal_entity_id = s.legal_entity_id)
        or (a.scope_type = 'STATION' and a.station_id = s.id)
      )
  `;
}

export async function soleOwnerMayApproveOwn(
  transaction: Executor,
  scope: Parameters<typeof soleOwnerQuery>[0],
): Promise<boolean> {
  const rows = (await transaction.execute(soleOwnerQuery(scope))) as Array<{
    is_owner: boolean | null;
    has_other_owner: boolean | null;
  }>;
  return Boolean(rows[0]?.is_owner) && !rows[0]?.has_other_owner;
}
