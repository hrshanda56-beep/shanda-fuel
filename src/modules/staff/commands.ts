import 'server-only';

import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { getAuditSigningKey, getServerEnv } from '../../platform/config/env';
import { getDatabase } from '../../platform/db';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { createResendEmailSender, type EmailSender } from '../../platform/email';
import { appendSecurityEvent } from '../audit/contracts';
import { authorize } from '../../platform/security/permissions';
import { requireAuthenticatedActor } from '../identity';
import { resolveTenantExecutionContext, type TenantExecutionContext } from '../tenancy/server';

import {
  assertInvitationToken,
  createInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  normalizeEmail,
  parseRole,
  validateInvitationScope,
} from './domain';
import type { InvitationView, StaffInvitationScope } from './contracts';
import { resolveInvitationView } from './queries';

type StaffTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0];

const createSchema = z.object({
  commandType: z.literal('CreateStaffInvitation'),
  tenantId: z.string().uuid(),
  invitedName: z.string().trim().min(1).max(160),
  invitedEmail: z.string().trim().email().max(320),
  assignedRole: z.enum(['OWNER', 'ADMINISTRATOR', 'FINANCE', 'SUPERVISOR', 'ATTENDANT']),
  scopeType: z.enum(['TENANT', 'LEGAL_ENTITY', 'STATION']),
  legalEntityId: z.string().uuid().optional(),
  stationIds: z.array(z.string().uuid()).max(100).default([]),
});

const resendSchema = z.object({
  commandType: z.literal('ResendStaffInvitation'),
  tenantId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

const revokeSchema = z.object({
  commandType: z.literal('RevokeStaffInvitation'),
  tenantId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

const deactivateSchema = z.object({
  commandType: z.literal('DeactivateStaffMember'),
  tenantId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

const acceptanceSchema = z.object({ token: z.string().min(1).max(256) });
const signupSchema = z.object({ token: z.string().min(1).max(256), password: z.string().min(1) });

export type StaffCommandDependencies = Readonly<{
  emailSender?: EmailSender;
  resolveAuthority?: typeof resolveTenantExecutionContext;
}>;

function transactionError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === '23505') return new AppError('CONFLICT', 'That staff invitation already exists');
    if (code === 'P0001')
      return new AppError('FORBIDDEN', 'This invitation is no longer available');
  }
  return new AppError('INTERNAL_ERROR', 'The staff operation could not be completed');
}

function hasTenantRole(authority: TenantExecutionContext, role: 'OWNER' | 'ADMINISTRATOR') {
  return authority.authorization.roleAssignments.some(
    (assignment) => assignment.roleCode === role && assignment.scopeType === 'TENANT',
  );
}

function authorizeInvitation(
  authority: TenantExecutionContext,
  role: 'OWNER' | 'ADMINISTRATOR' | 'FINANCE' | 'SUPERVISOR' | 'ATTENDANT',
  scope: StaffInvitationScope,
) {
  const tenantScope = { tenantId: authority.membership.tenantId, scopeType: 'TENANT' as const };
  if ((role === 'OWNER' || role === 'ADMINISTRATOR') && !hasTenantRole(authority, 'OWNER')) {
    throw new AppError('FORBIDDEN', 'Only an owner can invite privileged staff');
  }
  if (
    role !== 'OWNER' &&
    role !== 'ADMINISTRATOR' &&
    !hasTenantRole(authority, 'OWNER') &&
    !hasTenantRole(authority, 'ADMINISTRATOR')
  ) {
    throw new AppError('FORBIDDEN', 'Only an owner or administrator can invite staff');
  }
  if (scope.scopeType === 'TENANT') {
    authorize({
      actor: authority.authorization,
      permissionCode: 'membership.invite',
      requestedScope: tenantScope,
    });
    return;
  }
  if (scope.scopeType === 'LEGAL_ENTITY') {
    authorize({
      actor: authority.authorization,
      permissionCode: 'membership.invite',
      requestedScope: {
        tenantId: tenantScope.tenantId,
        scopeType: 'LEGAL_ENTITY',
        legalEntityId: scope.legalEntityId!,
      },
    });
    return;
  }
  for (const stationId of scope.stationIds) {
    authorize({
      actor: authority.authorization,
      permissionCode: 'membership.invite',
      requestedScope: {
        tenantId: tenantScope.tenantId,
        scopeType: 'STATION',
        legalEntityId: scope.legalEntityId!,
        stationId,
      },
    });
  }
}

async function sendInvitationEmail(input: {
  token: string;
  email: string;
  name: string;
  organisationName: string;
  emailSender?: EmailSender;
}): Promise<'sent' | 'failed'> {
  try {
    const sender = input.emailSender ?? createResendEmailSender();
    const appUrl = getServerEnv().APP_URL.replace(/\/$/, '');
    const url = `${appUrl}/invite/${input.token}`;
    await sender.send({
      to: input.email,
      subject: `Your ${input.organisationName} invitation`,
      text: `Hello ${input.name},\n\nYou have been invited to join ${input.organisationName} on Shanda Fuel.\n\nOpen this link to continue: ${url}\n\nThis link expires after 72 hours.`,
    });
    return 'sent';
  } catch {
    return 'failed';
  }
}

async function resolveStaffAuthority(
  request: Request,
  tenantId: string,
  deps: StaffCommandDependencies,
) {
  return (deps.resolveAuthority ?? resolveTenantExecutionContext)({
    request,
    requestedTenantId: tenantId,
  });
}

export async function createStaffInvitationFromRequest(
  request: Request,
  body: unknown,
  deps: StaffCommandDependencies = {},
) {
  const input = createSchema.parse(body);
  const role = parseRole(input.assignedRole);
  const scope = validateInvitationScope(role, {
    scopeType: input.scopeType,
    legalEntityId: input.legalEntityId,
    stationIds: input.stationIds,
  });
  const authority = await resolveStaffAuthority(request, input.tenantId, deps);
  authorizeInvitation(authority, role, scope);

  const email = normalizeEmail(input.invitedEmail);
  const token = createInvitationToken();
  const expiresAt = invitationExpiry();
  let result: { invitationId: string; organisationName: string };

  try {
    result = await withTenantTransaction(authority.transaction, async (transaction) => {
      await transaction.execute(
        sql`select id from app.tenants where id = ${input.tenantId} for update`,
      );
      const existingMembership = await transaction.execute<{ id: string; status: string }>(sql`
        select membership.id, membership.status
        from app.memberships membership
        join auth."user" identity on identity.id = membership.identity_id
        where membership.tenant_id = ${input.tenantId}
          and lower(btrim(identity.email)) = ${email}
        for update
      `);
      if (existingMembership[0]) {
        throw new AppError(
          'CONFLICT',
          'That email already has a staff record in this organisation',
        );
      }

      const pending = await transaction.execute<{ id: string; expires_at: Date }>(sql`
        select id, expires_at
        from app.staff_invitations
        where tenant_id = ${input.tenantId}
          and invited_email = ${email}
          and status = 'PENDING'
        for update
      `);
      if (pending[0]) {
        if (new Date(pending[0].expires_at).getTime() > Date.now()) {
          throw new AppError('CONFLICT', 'That email already has a pending invitation');
        }
        await transaction.execute(sql`
          update app.staff_invitations
          set status = 'EXPIRED', updated_at = clock_timestamp()
          where id = ${pending[0].id}
        `);
      }

      if (scope.scopeType === 'STATION') {
        const stations = await transaction.execute<{ station_id: string }>(sql`
          select id as station_id
          from app.stations
          where tenant_id = ${input.tenantId}
            and legal_entity_id = ${scope.legalEntityId!}
            and id in (${sql.join(
              scope.stationIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
            and status = 'ACTIVE'
          order by id
        `);
        if (stations.length !== scope.stationIds.length) {
          throw new AppError('FORBIDDEN', 'One or more selected stations are not available');
        }
      } else if (scope.scopeType === 'LEGAL_ENTITY') {
        const legalEntity = await transaction.execute(sql`
          select id from app.legal_entities
          where tenant_id = ${input.tenantId} and id = ${scope.legalEntityId!} and status = 'ACTIVE'
        `);
        if (!legalEntity[0])
          throw new AppError('FORBIDDEN', 'The selected legal entity is not available');
      }

      const rows = await transaction.execute<{ id: string; name: string }>(sql`
        insert into app.staff_invitations (
          tenant_id, invited_email, invited_name, assigned_role, scope_type,
          legal_entity_id, token_hash, status, expires_at,
          created_by_user_id, created_by_membership_id
        )
        select ${input.tenantId}, ${email}, ${input.invitedName.trim()}, ${role}, ${scope.scopeType},
               ${scope.legalEntityId ?? null}, ${token.tokenHash}, 'PENDING', ${expiresAt},
               ${authority.actor.identityId}, ${authority.membership.membershipId}
        returning id, (select name from app.tenants where id = ${input.tenantId})
      `);
      const invitation = rows[0];
      if (!invitation) throw new AppError('INTERNAL_ERROR', 'The invitation was not created');

      if (scope.scopeType === 'STATION') {
        await transaction.execute(sql`
          insert into app.staff_invitation_stations (
            tenant_id, invitation_id, legal_entity_id, station_id
          )
          select ${input.tenantId}, ${invitation.id}, ${scope.legalEntityId}, selected.station_id
          from unnest(${scope.stationIds}::uuid[]) as selected(station_id)
        `);
      }

      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: input.tenantId,
          membershipId: authority.membership.membershipId,
          actorId: authority.actor.identityId,
          actorType: 'HUMAN',
          actionCode: 'STAFF.INVITATION_CREATED',
          subjectType: 'StaffInvitation',
          subjectId: invitation.id,
          requestId: authority.transaction.requestId!,
          occurredAt: new Date().toISOString(),
          after: {
            role,
            scopeType: scope.scopeType,
            legalEntityId: scope.legalEntityId,
            stationCount: scope.stationIds.length,
          },
        },
        getAuditSigningKey(),
        transaction,
      );
      return { invitationId: invitation.id, organisationName: String(invitation.name) };
    });
  } catch (error) {
    throw transactionError(error);
  }

  const delivery = await sendInvitationEmail({
    token: token.token,
    email,
    name: input.invitedName.trim(),
    organisationName: result.organisationName,
    emailSender: deps.emailSender,
  });
  return { invitationId: result.invitationId, delivery };
}

async function updateInvitationToken(
  request: Request,
  body: unknown,
  deps: StaffCommandDependencies,
  actionCode: 'STAFF.INVITATION_RESENT' | 'STAFF.INVITATION_REVOKED',
) {
  const input =
    actionCode === 'STAFF.INVITATION_RESENT' ? resendSchema.parse(body) : revokeSchema.parse(body);
  const authority = await resolveStaffAuthority(request, input.tenantId, deps);
  authorize({
    actor: authority.authorization,
    permissionCode:
      actionCode === 'STAFF.INVITATION_RESENT' ? 'membership.invite' : 'membership.manage',
    requestedScope: { tenantId: input.tenantId, scopeType: 'TENANT' },
  });
  const nextToken = actionCode === 'STAFF.INVITATION_RESENT' ? createInvitationToken() : undefined;
  const expiresAt = nextToken ? invitationExpiry() : undefined;
  let emailDetails: { email: string; name: string; organisationName: string } | undefined;

  try {
    await withTenantTransaction(authority.transaction, async (transaction) => {
      const rows = await transaction.execute<{
        id: string;
        invited_email: string;
        invited_name: string;
        status: string;
        tenant_name: string;
      }>(sql`
        select invitation.id, invitation.invited_email, invitation.invited_name,
               invitation.status, tenant.name as tenant_name
        from app.staff_invitations invitation
        join app.tenants tenant on tenant.id = invitation.tenant_id
        where invitation.tenant_id = ${input.tenantId}
          and invitation.id = ${input.invitationId}
        for update
      `);
      const invitation = rows[0];
      if (!invitation || !['PENDING', 'EXPIRED'].includes(invitation.status)) {
        throw new AppError('CONFLICT', 'That invitation is no longer available');
      }
      if (nextToken) {
        await transaction.execute(sql`
          update app.staff_invitations
          set token_hash = ${nextToken.tokenHash}, status = 'PENDING',
              expires_at = ${expiresAt!}, updated_at = clock_timestamp()
          where id = ${input.invitationId}
        `);
        emailDetails = {
          email: invitation.invited_email,
          name: invitation.invited_name,
          organisationName: invitation.tenant_name,
        };
      } else {
        await transaction.execute(sql`
          update app.staff_invitations
          set status = 'REVOKED', revoked_at = clock_timestamp(),
              revoked_by_user_id = ${authority.actor.identityId}, updated_at = clock_timestamp()
          where id = ${input.invitationId}
        `);
      }
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: input.tenantId,
          membershipId: authority.membership.membershipId,
          actorId: authority.actor.identityId,
          actorType: 'HUMAN',
          actionCode,
          subjectType: 'StaffInvitation',
          subjectId: input.invitationId,
          requestId: authority.transaction.requestId!,
          occurredAt: new Date().toISOString(),
        },
        getAuditSigningKey(),
        transaction,
      );
    });
  } catch (error) {
    throw transactionError(error);
  }

  if (nextToken && emailDetails) {
    const delivery = await sendInvitationEmail({
      ...emailDetails,
      token: nextToken.token,
      emailSender: deps.emailSender,
    });
    return { invitationId: input.invitationId, delivery };
  }
  return { invitationId: input.invitationId, revoked: true };
}

export const resendStaffInvitationFromRequest = (
  request: Request,
  body: unknown,
  deps: StaffCommandDependencies = {},
) => updateInvitationToken(request, body, deps, 'STAFF.INVITATION_RESENT');

export const revokeStaffInvitationFromRequest = (
  request: Request,
  body: unknown,
  deps: StaffCommandDependencies = {},
) => updateInvitationToken(request, body, deps, 'STAFF.INVITATION_REVOKED');

export async function deactivateStaffMemberFromRequest(
  request: Request,
  body: unknown,
  deps: StaffCommandDependencies = {},
) {
  const input = deactivateSchema.parse(body);
  const authority = await resolveStaffAuthority(request, input.tenantId, deps);
  authorize({
    actor: authority.authorization,
    permissionCode: 'membership.disable',
    requestedScope: { tenantId: input.tenantId, scopeType: 'TENANT' },
  });
  if (input.membershipId === authority.membership.membershipId) {
    throw new AppError('FORBIDDEN', 'You cannot deactivate your own membership');
  }

  try {
    return await withTenantTransaction(authority.transaction, async (transaction) => {
      await transaction.execute(
        sql`select id from app.tenants where id = ${input.tenantId} for update`,
      );
      const targetRows = await transaction.execute<{ identity_id: string; status: string }>(sql`
        select identity_id, status from app.memberships
        where tenant_id = ${input.tenantId} and id = ${input.membershipId}
        for update
      `);
      const target = targetRows[0];
      if (!target) throw new AppError('NOT_FOUND', 'Staff member not found');
      if (target.status !== 'ACTIVE')
        throw new AppError('CONFLICT', 'Staff member is already inactive');

      const ownerRows = await transaction.execute<{ count: string }>(sql`
        select count(*)::text as count
        from app.memberships membership
        join app.membership_role_assignments assignment
          on assignment.tenant_id = membership.tenant_id
         and assignment.membership_id = membership.id
        where membership.tenant_id = ${input.tenantId}
          and membership.status = 'ACTIVE'
          and assignment.role_code = 'OWNER'
          and assignment.scope_type = 'TENANT'
          and (assignment.expires_at is null or assignment.expires_at > now())
      `);
      const targetOwner = await transaction.execute(sql`
        select 1 from app.membership_role_assignments
        where tenant_id = ${input.tenantId}
          and membership_id = ${input.membershipId}
          and role_code = 'OWNER'
          and scope_type = 'TENANT'
          and (expires_at is null or expires_at > now())
        limit 1
      `);
      if (targetOwner[0] && Number(ownerRows[0]?.count ?? 0) <= 1) {
        throw new AppError('INVARIANT_VIOLATION', 'The last active owner cannot be deactivated');
      }

      await transaction.execute(sql`
        update app.memberships
        set status = 'DISABLED', disabled_at = clock_timestamp(), updated_at = clock_timestamp()
        where tenant_id = ${input.tenantId} and id = ${input.membershipId}
      `);
      await transaction.execute(sql`
        update app.staff_invitations invitation
        set status = 'REVOKED', revoked_at = clock_timestamp(),
            revoked_by_user_id = ${authority.actor.identityId}, updated_at = clock_timestamp()
        from auth."user" identity
        where invitation.tenant_id = ${input.tenantId}
          and invitation.status = 'PENDING'
          and identity.id = ${target.identity_id}
          and invitation.invited_email = lower(btrim(identity.email))
      `);
      await transaction.execute(sql`
        update auth.session
        set revoked_at = coalesce(revoked_at, clock_timestamp()), updated_at = clock_timestamp()
        where user_id = ${target.identity_id} and revoked_at is null
      `);
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: input.tenantId,
          membershipId: authority.membership.membershipId,
          actorId: authority.actor.identityId,
          actorType: 'HUMAN',
          actionCode: 'STAFF.MEMBERSHIP_DEACTIVATED',
          subjectType: 'Membership',
          subjectId: input.membershipId,
          requestId: authority.transaction.requestId!,
          occurredAt: new Date().toISOString(),
        },
        getAuditSigningKey(),
        transaction,
      );
      return { membershipId: input.membershipId, sessionsRevoked: true };
    });
  } catch (error) {
    throw transactionError(error);
  }
}

export async function acceptStaffInvitationFromRequest(request: Request, body: unknown) {
  const input = acceptanceSchema.parse(body);
  const token = assertInvitationToken(input.token);
  const actor = await requireAuthenticatedActor(request);
  const requestId = randomUUID();
  try {
    return await getDatabase().transaction(async (transaction) => {
      const rows = await transaction.execute<{
        invitation_id: string;
        tenant_id: string;
        membership_id: string;
      }>(sql`
        select * from app.accept_staff_invitation(${hashInvitationToken(token)}, ${actor.identityId}, ${requestId})
      `);
      const result = rows[0];
      if (!result) throw new AppError('FORBIDDEN', 'This invitation is no longer available');
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: result.tenant_id,
          membershipId: result.membership_id,
          actorId: actor.identityId,
          actorType: 'HUMAN',
          actionCode: 'STAFF.INVITATION_ACCEPTED',
          subjectType: 'StaffInvitation',
          subjectId: result.invitation_id,
          requestId,
          occurredAt: new Date().toISOString(),
        },
        getAuditSigningKey(),
        transaction,
      );
      return { accepted: true, tenantId: result.tenant_id };
    });
  } catch (error) {
    throw transactionError(error);
  }
}

export async function signUpFromInvitation(body: unknown) {
  const input = signupSchema.parse(body);
  const token = assertInvitationToken(input.token);
  const view: InvitationView = await resolveInvitationView(token);
  if (view.kind !== 'new-identity') {
    throw new AppError('FORBIDDEN', 'This invitation is no longer available');
  }
  const userId = randomUUID();
  const accountId = randomUUID();
  const password = await hashPassword(input.password);

  try {
    await getDatabase().transaction(async (transaction) => {
      const current = await transaction.execute(sql`
        select invitation_id from app.resolve_staff_invitation(${hashInvitationToken(token)})
      `);
      if (!current[0]) throw new AppError('FORBIDDEN', 'This invitation is no longer available');
      await transaction.execute(sql`
        insert into auth."user" (id, name, email, email_verified)
        values (${userId}, ${view.invitedName}, ${view.email}, true)
      `);
      await transaction.execute(sql`
        insert into auth.account (id, account_id, provider_id, user_id, password)
        values (${accountId}, ${userId}, 'credential', ${userId}, ${password})
      `);
    });
  } catch (error) {
    throw transactionError(error);
  }
  return { email: view.email };
}
