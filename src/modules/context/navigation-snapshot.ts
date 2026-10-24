import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '../../platform/db';
import { memoizeRequestRead } from '../../platform/security/request-read-scope';
import {
  roleAssignmentFromRow,
  temporaryGrantFromRow,
  type MembershipRecord,
} from '../tenancy/authority';
import type { AuthorizedContextRow } from './queries';

const permissionScope = z.object({
  tenant_id: z.string().uuid(),
  membership_id: z.string().uuid(),
  scope_type: z.string(),
  legal_entity_id: z.string().uuid().nullable(),
  station_id: z.string().uuid().nullable(),
  expires_at: z.string().datetime({ offset: true }).nullable(),
});
const snapshotSchema = z.object({
  tenant_id: z.string().uuid(),
  membership_id: z.string().uuid(),
  identity_id: z.string().uuid(),
  roles: z.array(permissionScope.extend({ role_code: z.string() })),
  grants: z.array(
    permissionScope.extend({
      permission_code: z.string(),
      expires_at: z.string().datetime({ offset: true }),
      revoked_at: z.null(),
    }),
  ),
  context_rows: z.array(
    z.object({
      organisation_id: z.string().uuid(),
      organisation_name: z.string(),
      legal_entity_id: z.string().uuid().nullable(),
      legal_entity_name: z.string().nullable(),
      station_id: z.string().uuid().nullable(),
      station_code: z.string().nullable(),
      station_name: z.string().nullable(),
      station_timezone: z.string().nullable(),
    }),
  ),
});
export function decodeNavigationMembership(input: unknown, actorId: string): MembershipRecord {
  const row = snapshotSchema.parse(input);
  if (
    row.identity_id !== actorId ||
    [...row.roles, ...row.grants].some(
      (item) => item.tenant_id !== row.tenant_id || item.membership_id !== row.membership_id,
    ) ||
    row.context_rows.some((item) => item.organisation_id !== row.tenant_id)
  ) {
    throw new Error('Invalid navigation authority binding');
  }
  return {
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    identityId: row.identity_id,
    actorId: row.identity_id,
    status: 'ACTIVE',
    roleAssignments: row.roles.map((role) =>
      roleAssignmentFromRow({
        ...role,
        expires_at: role.expires_at ? new Date(role.expires_at) : null,
      }),
    ),
    temporaryGrants: row.grants.map((grant) =>
      temporaryGrantFromRow({ ...grant, expires_at: new Date(grant.expires_at) }),
    ),
  };
}
export function decodeNavigationSnapshot(rows: unknown[], actorId: string) {
  return rows.map((input) => {
    const membership = decodeNavigationMembership(input, actorId);
    return { membership, rows: snapshotSchema.parse(input).context_rows };
  });
}
const snapshotRead = Symbol('navigation-context-snapshot');
export function readNavigationSnapshot(
  actorId: string,
): Promise<Array<{ membership: MembershipRecord; rows: AuthorizedContextRow[] }>> {
  return memoizeRequestRead(snapshotRead, actorId, async () => {
    const rows = await getDatabase().execute(
      sql`select * from app.read_navigation_context(${actorId}::uuid)`,
    );
    return decodeNavigationSnapshot(rows, actorId);
  });
}
