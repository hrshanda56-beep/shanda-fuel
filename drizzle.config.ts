import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/platform/db/schema/**/*.ts',
  out: './src/platform/db/migrations',
  schemaFilter: ['app', 'auth', 'platform'],
  dbCredentials: {
    // Drizzle Kit can validate/generate without a live database. Commands that
    // connect must provide DATABASE_DIRECT_URL (or DATABASE_URL) explicitly.
    url: databaseUrl ?? 'postgresql://localhost:5432/shanda_fuel_dev',
  },
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
});
