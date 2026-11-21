import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { memberships, stations } from './a1';

/**
 * Every ZERA monthly return a person saved, as it was on the day (migration 0118). A correction is a
 * new version; earlier versions stay. The application role can read and add rows, never change them.
 */
export const zeraReturns = appSchema.table(
  'zera_returns',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    month: text('month').notNull(),
    version: integer('version').notNull(),
    /** The fourteen answers as shown: [{ label, value }]. */
    answers: jsonb('answers').notNull(),
    /** The worked-out figures and the reasons behind them. */
    figures: jsonb('figures').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('zera_returns_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('zera_returns_version_uidx').on(
      table.tenantId,
      table.stationId,
      table.month,
      table.version,
    ),
    check('zera_returns_month_ck', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('zera_returns_version_ck', sql`${table.version} >= 1`),
    check(
      'zera_returns_answers_ck',
      sql`jsonb_typeof(${table.answers}) = 'array' AND jsonb_array_length(${table.answers}) = 14`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'zera_returns_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'zera_returns_created_by_fk',
    }),
    index('zera_returns_station_idx').on(
      table.tenantId,
      table.stationId,
      table.month,
      table.version.desc(),
    ),
  ],
);
