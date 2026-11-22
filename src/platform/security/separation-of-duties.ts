import { sql } from 'drizzle-orm';

type Executor = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

/**
 * Separation of duties with an owner exemption (DEC-057).
 *
 * The person who prepared a record may not approve it, unless they are an active owner at the
 * station: an owner never waits on anyone, however many owners there are. Finance and
 * administrators need another approver or an owner; supervisors and attendants never approve
 * their own and are never counted as the "someone else". The approval permission itself is
 * checked separately, so this only decides whether self-approval is allowed.
 *
 * The query returns a row when self-approval is NOT allowed (someone else must approve).
 */
export function alternateApproverQuery(scope: {
  tenantId: string;
  stationId: string;
  excludeMembershipId: string;
}) {
  return sql`
    select 1 as found
    from (${ownerQuery({
      tenantId: scope.tenantId,
      stationId: scope.stationId,
      membershipId: scope.excludeMembershipId,
    })}) o
    where not coalesce(o.is_owner, false)
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

/** Whether the member is an active owner at the station. */
export function ownerQuery(scope: { tenantId: string; stationId: string; membershipId: string }) {
  return sql`
    select bool_or(m.id = ${scope.membershipId}) as is_owner
    from app.membership_role_assignments a
    join app.member_directory(${scope.tenantId}::uuid) m on m.id = a.membership_id
    join app.stations s
      on s.tenant_id = a.tenant_id and s.id = ${scope.stationId}
    where a.tenant_id = ${scope.tenantId}
      and a.membership_id = ${scope.membershipId}
      and a.role_code = 'OWNER'
      and m.status = 'ACTIVE'
      and (a.expires_at is null or a.expires_at > now())
      and (
        a.scope_type = 'TENANT'
        or (a.scope_type = 'LEGAL_ENTITY' and a.legal_entity_id = s.legal_entity_id)
        or (a.scope_type = 'STATION' and a.station_id = s.id)
      )
  `;
}

export async function ownerMayApproveOwn(
  transaction: Executor,
  scope: Parameters<typeof ownerQuery>[0],
): Promise<boolean> {
  const rows = (await transaction.execute(ownerQuery(scope))) as Array<{
    is_owner: boolean | null;
  }>;
  return Boolean(rows[0]?.is_owner);
}
