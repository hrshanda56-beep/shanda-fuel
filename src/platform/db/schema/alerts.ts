import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { memberships, stations } from './a1';

export const alertEmailPreferences = appSchema.table(
  'alert_email_preferences',
  {
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.membershipId] }),
    foreignKey({
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'alert_email_preferences_membership_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'alert_email_preferences_updated_by_fk',
    }),
  ],
);

export const alertEmailDeliveries = appSchema.table(
  'alert_email_deliveries',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    stationId: uuid('station_id').notNull(),
    digestKey: text('digest_key').notNull(),
    itemIds: jsonb('item_ids').notNull(),
    state: text('state').notNull().default('CLAIMED'),
    providerMessageId: text('provider_message_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('alert_email_deliveries_recipient_idx').on(
      table.tenantId,
      table.membershipId,
      table.stationId,
      table.sentAt,
    ),
    unique('alert_email_deliveries_recipient_digest_uidx').on(
      table.tenantId,
      table.membershipId,
      table.stationId,
      table.digestKey,
    ),
    check('alert_email_deliveries_state_ck', sql`${table.state} in ('CLAIMED', 'FAILED', 'SENT')`),
    check('alert_email_deliveries_digest_key_ck', sql`btrim(${table.digestKey}) <> ''`),
    check(
      'alert_email_deliveries_sent_shape_ck',
      sql`(${table.state} = 'SENT' and ${table.sentAt} is not null and ${table.providerMessageId} is not null) or ${table.state} <> 'SENT'`,
    ),
    foreignKey({
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'alert_email_deliveries_membership_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'alert_email_deliveries_station_fk',
    }),
  ],
);
