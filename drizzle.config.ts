import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Match Next's local-development precedence without overriding injected values.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const databaseUrl = process.env.DATABASE_DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (process.argv.includes('migrate') && !databaseUrl) {
  throw new Error('Set DATABASE_DIRECT_URL in .env.local or .env before running migrations.');
}

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
