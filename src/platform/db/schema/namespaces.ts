import { pgSchema } from 'drizzle-orm/pg-core';

/** Namespace declarations only; business tables belong to their owning modules. */
export const authSchema = pgSchema('auth');
export const appSchema = pgSchema('app');
export const platformSchema = pgSchema('platform');
