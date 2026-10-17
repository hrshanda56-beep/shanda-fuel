import { sql } from 'drizzle-orm';
import { check, index, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';
import { tenants } from './a1';
import { appSchema } from './namespaces';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();

export const authIdentities = appSchema.table(
  'auth_identities',
  {
    id: id(),
    internalUserId: uuid('internal_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('auth_identities_provider_user_uidx').on(table.provider, table.providerUserId),
    unique('auth_identities_internal_user_provider_uidx').on(table.internalUserId, table.provider),
    index('auth_identities_internal_user_idx').on(table.internalUserId),
    check('auth_identities_provider_ck', sql`${table.provider} in ('BETTER_AUTH', 'CLERK')`),
    check('auth_identities_provider_user_id_ck', sql`btrim(${table.providerUserId}) <> ''`),
  ],
);

export const authSessionAssurance = appSchema.table(
  'auth_session_assurance',
  {
    id: id(),
    provider: text('provider').notNull(),
    providerSessionId: text('provider_session_id').notNull(),
    internalUserId: uuid('internal_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assuranceLevel: integer('assurance_level').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('auth_session_assurance_provider_session_uidx').on(
      table.provider,
      table.providerSessionId,
    ),
    index('auth_session_assurance_lookup_idx')
      .on(table.provider, table.providerSessionId, table.internalUserId, table.tenantId)
      .where(sql`${table.revokedAt} is null`),
    check('auth_session_assurance_provider_ck', sql`${table.provider} in ('BETTER_AUTH', 'CLERK')`),
    check('auth_session_assurance_level_ck', sql`${table.assuranceLevel} in (1, 2)`),
  ],
);
