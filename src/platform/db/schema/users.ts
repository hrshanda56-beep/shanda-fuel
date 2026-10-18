import { sql } from 'drizzle-orm';
import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';

const generatedUuid = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();

export const users = appSchema.table('users', {
  id: generatedUuid(),
  name: text('name').notNull(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
