# Database architecture

## A0 foundation

The server-only database boundary lives under `src/platform/db/`. Runtime queries use the pooled `DATABASE_URL`; direct migration commands use `DATABASE_DIRECT_URL` when configured and must never target production from local development.

The canonical migration history is `src/platform/db/migrations/` and is owned by A0/integration. The current integrated sequence is `0000` through `0003`; it must remain one append-only Drizzle history. The schema source is `src/platform/db/schema/**/*.ts`. Feature agents propose schema changes in their module boundary; A0 assigns the next migration number and integrates the reviewed migration. The initial migration reserves the logical `auth`, `app`, and `platform` namespaces only. It intentionally creates no business tables.

CI provisions the reviewed non-login roles, applies this migration history to an ephemeral PostgreSQL test database using `DATABASE_DIRECT_URL`, and then runs the integration suite through the pooled `DATABASE_URL`. The integration gate requires `DATABASE_URL` and fails clearly when it is absent.

The request path is server authentication → tenant-authority resolution → application command/query service → repository/persistence adapter → `withTenantTransaction` → PostgreSQL. `withTenantTransaction` requires a branded server-owned tenant, actor, and membership context and sets transaction-local context keys. A1 owns the complete fail-closed PostgreSQL RLS implementation and the migration-ready runtime-role policy. Repository code must not treat a client-selected tenant ID as authority, open a second connection, or perform tenant-owned work outside this transaction boundary.

The target logical schemas are `auth`, `app`, and `platform`; the runtime must fail closed when tenant context is absent.
