import { sql } from 'drizzle-orm';
import { boolean, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authSchema } from './namespaces';

const generatedUuid = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();

export const authUser = authSchema.table('user', {
  id: generatedUuid(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const authSession = authSchema.table(
  'session',
  {
    id: generatedUuid(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    revokedAt: timestamp('revoked_at'),
    strongAuthenticatedAt: timestamp('strong_authenticated_at'),
    strongAuthenticationExpiresAt: timestamp('strong_authentication_expires_at'),
    strongAuthenticationVerified: boolean('strong_authentication_verified'),
    stepUpLevel: integer('step_up_level'),
    stepUpExpiresAt: timestamp('step_up_expires_at'),
  },
  (table) => [index('auth_session_user_id_idx').on(table.userId)],
);

export const authAccount = authSchema.table(
  'account',
  {
    id: generatedUuid(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('auth_account_user_id_idx').on(table.userId),
    uniqueIndex('auth_account_provider_account_uidx').on(table.providerId, table.accountId),
  ],
);

export const authVerification = authSchema.table(
  'verification',
  {
    id: generatedUuid(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('auth_verification_identifier_idx').on(table.identifier)],
);

export const authTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
};
