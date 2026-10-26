import 'server-only';

import { sql } from 'drizzle-orm';

import { getDatabase } from '../../platform/db';
import { withTenantTransaction } from '../../platform/db/transaction';
import { isAuthorized, type RoleCode } from '../../platform/security';
import { isPermissionGranted } from '../../platform/security/permissions';
import type { TenantExecutionContext } from '../tenancy/server';

import { assertInvitationToken, hashInvitationToken } from './domain';
import type {
  InvitationView,
  StaffInvitationSummary,
  StaffMemberSummary,
  StaffOverview,
  StaffScopeOption,
} from './contracts';

type StaffTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0];

type InvitationRow = {
  id: string;
  invited_email: string | null;
  invited_name: string;
  assigned_role: string;
  scope_type: string;
  legal_entity_id: string | null;
  status: StaffInvitationSummary['status'];
  expires_at: Date;
  created_at: Date;
  station_ids: string[] | null;
  delivery_method: 'EMAIL' | 'MANUAL';
  staff_number: string | null;
};

type StaffRow = {
  membership_id: string;
  identity_id: string;
  name: string;
  email: string | null;
  staff_number: string | null;
  status: StaffMemberSummary['status'];
  roles: string[] | null;
  scope_labels: string[] | null;
  assignments: StaffMemberSummary['assignments'] | null;
};

export type StaffOverviewDependencies = Readonly<{
  now?: Date;
}>;

function role(value: string): RoleCode {
  return value as RoleCode;
}

function invitationSummary(row: InvitationRow): StaffInvitationSummary {
  return {
    id: row.id,
    email: row.invited_email,
    name: row.invited_name,
    role: role(row.assigned_role),
    scopeType: row.scope_type as StaffInvitationSummary['scopeType'],
    ...(row.legal_entity_id ? { legalEntityId: row.legal_entity_id } : {}),
    stationIds: row.station_ids ?? [],
    status: row.status,
    ...(row.status === 'PENDING' ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    deliveryMethod: row.delivery_method,
    ...(row.staff_number ? { staffNumber: row.staff_number } : {}),
  };
}

function staffSummary(row: StaffRow): StaffMemberSummary {
  return {
    membershipId: row.membership_id,
    identityId: row.identity_id,
    name: row.name,
    email: row.email,
    ...(row.staff_number ? { staffNumber: row.staff_number } : {}),
    status: row.status,
    roles: (row.roles ?? []).map(role),
    scopeLabels: row.scope_labels ?? [],
    assignments: row.assignments ?? [],
  };
}

export async function resolveInvitationView(token: string): Promise<InvitationView> {
  try {
    const rawToken = assertInvitationToken(token);
    const tokenHash = hashInvitationToken(rawToken);
    const rows = await getDatabase().execute<{
      organisation_name: string;
      invited_email: string;
      invited_name: string;
      existing_identity: boolean;
    }>(sql`
      select organisation_name, invited_email, invited_name, existing_identity
      from app.resolve_staff_invitation(${tokenHash})
    `);
    const row = rows[0];
    if (!row) return { kind: 'unavailable' };
    return row.existing_identity
      ? { kind: 'existing-identity', organisationName: row.organisation_name }
      : {
          kind: 'new-identity',
          organisationName: row.organisation_name,
          email: row.invited_email,
          invitedName: row.invited_name,
        };
  } catch {
    return { kind: 'unavailable' };
  }
}

async function readOverview(transaction: StaffTransaction): Promise<{
  pendingInvitations: StaffInvitationSummary[];
  activeStaff: StaffMemberSummary[];
  deactivatedStaff: StaffMemberSummary[];
}> {
  const invitationRows = await transaction.execute<InvitationRow>(sql`
    select
      invitation.id,
      invitation.invited_email,
      invitation.invited_name,
      invitation.assigned_role,
      invitation.scope_type,
      invitation.legal_entity_id,
      case
        when invitation.status = 'PENDING' and invitation.expires_at <= now() then 'EXPIRED'
        else invitation.status
      end as status,
      invitation.expires_at,
      invitation.created_at,
      invitation.delivery_method,
      (select staff_number from app.resolve_staff_number_for_invitation(invitation.id) limit 1)
        as staff_number,
      coalesce(
        (
          select array_agg(scope.station_id order by scope.station_id)
          from app.staff_invitation_stations scope
          where scope.tenant_id = invitation.tenant_id
            and scope.invitation_id = invitation.id
        ),
        '{}'
      ) as station_ids
    from app.staff_invitations invitation
    where invitation.tenant_id = current_setting('app.tenant_id')::uuid
      and invitation.status in ('PENDING', 'EXPIRED')
    order by invitation.created_at desc
  `);

  const staffRows = await transaction.execute<StaffRow>(sql`
    select
      membership.id as membership_id,
      identity.id as identity_id,
      identity.name,
      identity.email,
      (select staff_number from app.resolve_staff_number_for_user(identity.id) limit 1)
        as staff_number,
      membership.status,
      coalesce(array_agg(distinct assignment.role_code) filter (where assignment.id is not null), '{}') as roles,
      coalesce(array_agg(distinct case
        when assignment.scope_type = 'TENANT' then 'All organisation'
        when assignment.scope_type = 'LEGAL_ENTITY' then concat('Legal entity ', assignment.legal_entity_id::text)
        else concat('Station ', assignment.station_id::text)
      end) filter (where assignment.id is not null), '{}') as scope_labels,
      coalesce(jsonb_agg(distinct jsonb_build_object(
        'role', assignment.role_code, 'scopeType', assignment.scope_type,
        'legalEntityId', assignment.legal_entity_id, 'stationId', assignment.station_id
      )) filter (where assignment.id is not null), '[]'::jsonb) as assignments
    from app.memberships membership
    join app.users identity on identity.id = membership.identity_id
    left join app.membership_role_assignments assignment
      on assignment.tenant_id = membership.tenant_id
     and assignment.membership_id = membership.id
     and (assignment.expires_at is null or assignment.expires_at > now())
    where membership.tenant_id = current_setting('app.tenant_id')::uuid
    group by membership.id, identity.id, identity.name, identity.email, membership.status
    order by identity.name, identity.email
  `);

  const summaries = staffRows.map(staffSummary);
  return {
    pendingInvitations: invitationRows.map(invitationSummary),
    activeStaff: summaries.filter((staff) => staff.status === 'ACTIVE'),
    deactivatedStaff: summaries.filter((staff) => staff.status !== 'ACTIVE'),
  };
}

export async function resolveStaffOverview(
  authority: TenantExecutionContext,
  dependencies: StaffOverviewDependencies = {},
): Promise<StaffOverview> {
  const now = dependencies.now ?? new Date();
  const tenantScope = { tenantId: authority.membership.tenantId, scopeType: 'TENANT' as const };
  const canView = isPermissionGranted({
    actor: authority.authorization,
    permissionCode: 'membership.view',
    requestedScope: tenantScope,
    now,
  });
  const canInvite = isAuthorized({
    actor: authority.authorization,
    permissionCode: 'membership.invite',
    requestedScope: tenantScope,
    now,
  });
  const canInviteOwner =
    canInvite &&
    authority.authorization.roleAssignments.some(
      (assignment) => assignment.roleCode === 'OWNER' && assignment.scopeType === 'TENANT',
    );
  if (!canView) {
    return {
      canManage: false,
      canInviteOwner: false,
      scopeOptions: [],
      pendingInvitations: [],
      activeStaff: [],
      deactivatedStaff: [],
    };
  }

  const result = await withTenantTransaction(authority.transaction, async (transaction) => {
    const overview = await readOverview(transaction);
    const scopeRows = await transaction.execute<{
      legal_entity_id: string;
      legal_entity_name: string;
      station_id: string | null;
      station_code: string | null;
      station_name: string | null;
      station_status: string | null;
    }>(sql`
      select legal_entity.id as legal_entity_id,
             legal_entity.legal_name as legal_entity_name,
             station.id as station_id,
             station.code as station_code,
             station.name as station_name,
             station.status as station_status
      from app.legal_entities legal_entity
      left join app.stations station
        on station.tenant_id = legal_entity.tenant_id
       and station.legal_entity_id = legal_entity.id
       and station.status in ('ACTIVE', 'ONBOARDING')
      where legal_entity.tenant_id = current_setting('app.tenant_id')::uuid
        and legal_entity.status = 'ACTIVE'
      order by legal_entity.legal_name, station.code
    `);
    const scopeOptions = new Map<string, StaffScopeOption>();
    for (const row of scopeRows) {
      const legalEntityScope = {
        tenantId: authority.membership.tenantId,
        scopeType: 'LEGAL_ENTITY' as const,
        legalEntityId: row.legal_entity_id,
      };
      if (
        !isPermissionGranted({
          actor: authority.authorization,
          permissionCode: 'legal_entity.view',
          requestedScope: legalEntityScope,
          now,
        })
      )
        continue;
      let option = scopeOptions.get(row.legal_entity_id);
      if (!option) {
        option = { id: row.legal_entity_id, name: row.legal_entity_name, stations: [] };
        scopeOptions.set(row.legal_entity_id, option);
      }
      if (
        row.station_id &&
        row.station_code &&
        row.station_name &&
        isPermissionGranted({
          actor: authority.authorization,
          permissionCode: 'station.view',
          requestedScope: { ...legalEntityScope, scopeType: 'STATION', stationId: row.station_id },
          now,
        })
      ) {
        (option.stations as Array<StaffScopeOption['stations'][number]>).push({
          id: row.station_id,
          code: row.station_code,
          name: row.station_name,
          ...(row.station_status === 'ONBOARDING' ? { setup: true } : {}),
        });
      }
    }
    return { ...overview, scopeOptions: [...scopeOptions.values()] };
  });
  return { canManage: canInvite, canInviteOwner, ...result };
}
