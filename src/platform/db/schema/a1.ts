import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { appSchema, platformSchema } from './namespaces';

const generatedUuid = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();

export const tenants = appSchema.table(
  'tenants',
  {
    id: generatedUuid(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('tenants_status_idx').on(table.status)],
);

export const legalEntities = appSchema.table(
  'legal_entities',
  {
    id: generatedUuid(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    legalName: text('legal_name').notNull(),
    registrationReference: text('registration_reference'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('legal_entities_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('legal_entities_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const stations = appSchema.table(
  'stations',
  {
    id: generatedUuid(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Africa/Harare'),
    status: text('status').notNull().default('ONBOARDING'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('stations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('stations_tenant_code_uidx').on(table.tenantId, table.code),
    unique('stations_tenant_legal_entity_id_id_uidx').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    index('stations_tenant_status_idx').on(table.tenantId, table.status),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'stations_tenant_legal_entity_fk',
    }),
  ],
);

export const memberships = appSchema.table(
  'memberships',
  {
    id: generatedUuid(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('ACTIVE'),
    disabledAt: timestamp('disabled_at'),
    suspendedAt: timestamp('suspended_at'),
    lockedAt: timestamp('locked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('memberships_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('memberships_tenant_identity_uidx').on(table.tenantId, table.identityId),
    index('memberships_tenant_identity_idx').on(table.tenantId, table.identityId),
    index('memberships_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const permissionDefinitions = platformSchema.table('permission_definitions', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const roleDefinitions = platformSchema.table('role_definitions', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rolePermissions = platformSchema.table(
  'role_permissions',
  {
    roleCode: text('role_code')
      .notNull()
      .references(() => roleDefinitions.code),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissionDefinitions.code),
  },
  (table) => [primaryKey({ columns: [table.roleCode, table.permissionCode] })],
);

export const membershipRoleAssignments = appSchema.table(
  'membership_role_assignments',
  {
    id: generatedUuid(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid('membership_id').notNull(),
    roleCode: text('role_code')
      .notNull()
      .references(() => roleDefinitions.code),
    scopeType: text('scope_type').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    stationId: uuid('station_id'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('membership_role_assignments_tenant_id_uidx').on(table.tenantId, table.id),
    index('membership_role_assignments_membership_scope_idx').on(
      table.tenantId,
      table.membershipId,
      table.scopeType,
    ),
    index('membership_role_assignments_role_scope_idx').on(
      table.tenantId,
      table.roleCode,
      table.scopeType,
    ),
    foreignKey({
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'membership_role_assignments_membership_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'membership_role_assignments_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'membership_role_assignments_station_fk',
    }),
  ],
);

export const temporaryPermissionGrants = appSchema.table(
  'temporary_permission_grants',
  {
    id: generatedUuid(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid('membership_id').notNull(),
    permissionCode: text('permission_code').notNull(),
    scopeType: text('scope_type').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    stationId: uuid('station_id'),
    expiresAt: timestamp('expires_at').notNull(),
    reason: text('reason').notNull(),
    revokedAt: timestamp('revoked_at'),
    revokedByMembershipId: uuid('revoked_by_membership_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('temporary_permission_grants_tenant_id_uidx').on(table.tenantId, table.id),
    index('temporary_permission_grants_active_lookup_idx').on(
      table.tenantId,
      table.membershipId,
      table.permissionCode,
      table.expiresAt,
    ),
    index('temporary_permission_grants_revocation_idx').on(table.tenantId, table.revokedAt),
    foreignKey({
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'temporary_permission_grants_membership_fk',
    }),
    foreignKey({
      columns: [table.permissionCode],
      foreignColumns: [permissionDefinitions.code],
      name: 'temporary_permission_grants_permission_code_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'temporary_permission_grants_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'temporary_permission_grants_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.revokedByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'temporary_permission_grants_revoked_by_fk',
    }),
  ],
);

export const securityEvents = platformSchema.table(
  'security_events',
  {
    id: generatedUuid(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid('membership_id'),
    actorId: uuid('actor_id'),
    eventCode: text('event_code').notNull(),
    requestId: uuid('request_id').notNull(),
    occurredAt: timestamp('occurred_at').notNull().defaultNow(),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    keyId: text('key_id').notNull(),
    algorithm: text('algorithm').notNull().default('hmac-sha256'),
    signature: text('signature').notNull(),
  },
  (table) => [
    unique('security_events_tenant_id_uidx').on(table.tenantId, table.id),
    index('security_events_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
    index('security_events_tenant_event_code_idx').on(table.tenantId, table.eventCode),
    foreignKey({
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'security_events_membership_fk',
    }),
  ],
);
