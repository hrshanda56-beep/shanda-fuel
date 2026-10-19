import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';
import { legalEntities, memberships, roleDefinitions, stations, tenants } from './a1';
import { appSchema } from './namespaces';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();

const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

export const staffNumberRegistry = appSchema.table(
  'staff_number_registry',
  {
    id: id(),
    staffNumber: text('staff_number').notNull(),
    normalizedStaffNumber: text('normalized_staff_number').notNull(),
    reservedInvitationId: uuid('reserved_invitation_id'),
    internalUserId: uuid('internal_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    status: text('status').notNull().default('RESERVED'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('staff_number_registry_staff_number_uidx').on(table.normalizedStaffNumber),
    unique('staff_number_registry_invitation_uidx').on(table.reservedInvitationId),
    unique('staff_number_registry_internal_user_uidx').on(table.internalUserId),
    index('staff_number_registry_invitation_idx')
      .on(table.reservedInvitationId)
      .where(sql`${table.reservedInvitationId} is not null`),
    check(
      'staff_number_registry_staff_number_ck',
      sql`${table.staffNumber} ~ '^[A-Z0-9][A-Z0-9_-]{3,31}$'`,
    ),
    check(
      'staff_number_registry_normalized_ck',
      sql`${table.normalizedStaffNumber} = upper(btrim(${table.staffNumber}))`,
    ),
    check('staff_number_registry_status_ck', sql`${table.status} in ('RESERVED', 'ASSIGNED')`),
    check(
      'staff_number_registry_owner_ck',
      sql`(
        (${table.status} = 'RESERVED' and ${table.reservedInvitationId} is not null and ${table.internalUserId} is null)
        or (${table.status} = 'ASSIGNED' and ${table.reservedInvitationId} is null and ${table.internalUserId} is not null)
      )`,
    ),
  ],
);

export const staffInvitations = appSchema.table(
  'staff_invitations',
  {
    id: id(),
    tenantId: tenantId(),
    invitedEmail: text('invited_email'),
    invitedName: text('invited_name').notNull(),
    assignedRole: text('assigned_role').notNull(),
    scopeType: text('scope_type').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    tokenHash: text('token_hash').notNull(),
    activationFailedAttempts: integer('activation_failed_attempts').notNull().default(0),
    status: text('status').notNull().default('PENDING'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    acceptedAt: utcTimestamp('accepted_at'),
    revokedAt: utcTimestamp('revoked_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    revokedByUserId: uuid('revoked_by_user_id'),
    acceptedByUserId: uuid('accepted_by_user_id'),
    acceptedMembershipId: uuid('accepted_membership_id'),
    deliveryMethod: text('delivery_method').notNull().default('EMAIL'),
    staffNumberRegistryId: uuid('staff_number_registry_id').references(
      () => staffNumberRegistry.id,
      {
        onDelete: 'restrict',
      },
    ),
  },
  (table) => [
    check(
      'staff_invitations_activation_attempts_ck',
      sql`${table.activationFailedAttempts} between 0 and 5`,
    ),
    unique('staff_invitations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('staff_invitations_tenant_id_id_legal_entity_uidx').on(
      table.tenantId,
      table.id,
      table.legalEntityId,
    ),
    unique('staff_invitations_token_hash_uidx').on(table.tokenHash),
    uniqueIndex('staff_invitations_pending_email_uidx')
      .on(table.tenantId, table.invitedEmail)
      .where(sql`${table.status} = 'PENDING' and ${table.invitedEmail} is not null`),
    index('staff_invitations_tenant_status_idx').on(table.tenantId, table.status),
    index('staff_invitations_expiry_idx').on(table.tenantId, table.expiresAt),
    check(
      'staff_invitations_email_ck',
      sql`${table.invitedEmail} is null or ${table.invitedEmail} = lower(btrim(${table.invitedEmail}))`,
    ),
    check(
      'staff_invitations_delivery_method_ck',
      sql`${table.deliveryMethod} in ('EMAIL', 'MANUAL')`,
    ),
    check(
      'staff_invitations_manual_staff_number_ck',
      sql`${table.deliveryMethod} = 'EMAIL' or ${table.staffNumberRegistryId} is not null`,
    ),
    check('staff_invitations_name_ck', sql`btrim(${table.invitedName}) <> ''`),
    check('staff_invitations_token_hash_ck', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'staff_invitations_status_ck',
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')`,
    ),
    check(
      'staff_invitations_scope_ck',
      sql`(
        (${table.scopeType} = 'TENANT' and ${table.legalEntityId} is null and ${table.assignedRole} in ('OWNER', 'ADMINISTRATOR'))
        or (${table.scopeType} = 'LEGAL_ENTITY' and ${table.legalEntityId} is not null and ${table.assignedRole} = 'FINANCE')
        or (${table.scopeType} = 'STATION' and ${table.legalEntityId} is not null and ${table.assignedRole} in ('FINANCE', 'SUPERVISOR', 'ATTENDANT'))
      )`,
    ),
    check('staff_invitations_expiry_ck', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'staff_invitations_lifecycle_ck',
      sql`(
        (${table.status} = 'PENDING' and ${table.acceptedAt} is null and ${table.revokedAt} is null)
        or (${table.status} = 'ACCEPTED' and ${table.acceptedAt} is not null and ${table.revokedAt} is null)
        or (${table.status} = 'REVOKED' and ${table.acceptedAt} is null and ${table.revokedAt} is not null)
        or (${table.status} = 'EXPIRED' and ${table.acceptedAt} is null and ${table.revokedAt} is null)
      )`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'staff_invitations_tenant_fk',
    }),
    foreignKey({
      columns: [table.assignedRole],
      foreignColumns: [roleDefinitions.code],
      name: 'staff_invitations_role_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'staff_invitations_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: 'staff_invitations_created_by_user_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'staff_invitations_created_by_membership_fk',
    }),
    foreignKey({
      columns: [table.revokedByUserId],
      foreignColumns: [users.id],
      name: 'staff_invitations_revoked_by_user_fk',
    }),
    foreignKey({
      columns: [table.acceptedByUserId],
      foreignColumns: [users.id],
      name: 'staff_invitations_accepted_by_user_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.acceptedMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'staff_invitations_accepted_membership_fk',
    }),
  ],
);

export const staffInvitationStations = appSchema.table(
  'staff_invitation_stations',
  {
    id: id(),
    tenantId: tenantId(),
    invitationId: uuid('invitation_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('staff_invitation_stations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('staff_invitation_stations_invitation_station_uidx').on(
      table.tenantId,
      table.invitationId,
      table.stationId,
    ),
    index('staff_invitation_stations_station_idx').on(table.tenantId, table.stationId),
    foreignKey({
      columns: [table.tenantId, table.invitationId, table.legalEntityId],
      foreignColumns: [
        staffInvitations.tenantId,
        staffInvitations.id,
        staffInvitations.legalEntityId,
      ],
      name: 'staff_invitation_stations_invitation_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'staff_invitation_stations_station_fk',
    }),
  ],
);
