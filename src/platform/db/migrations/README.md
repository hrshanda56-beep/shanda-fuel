# Canonical migrations

This directory is the single production migration history for Shanda Fuel.

- A0/integration owns ordering, validation, and integration of canonical migrations.
- Feature agents may propose migration-ready schema changes in their owned module, but must not create competing production migration histories.
- Never run migration or push commands against production from local development.
- `DATABASE_DIRECT_URL` is intended for direct migration connections; `DATABASE_URL` is the pooled runtime connection.
- The integrated sequence is `0000_platform_namespaces`, `0001_a1_auth_identity`, `0002_a1_tenant_authorization_security`, then `0003_a3_forecourt_reconciliation`.
- `0001` is derived from the pinned Better Auth 1.7.5 configuration and owns the `auth` persistence tables. `0002` owns Shanda tenant authorization/security tables and its reviewed hand-authored RLS/grant layer.
- The Drizzle schema source is `src/platform/db/schema/**/*.ts`; the canonical generated/manual migration output is this directory. A schema file is not production-ready until its migration is reviewed and integrated here.
- The initial A0 migration only creates the `auth`, `app`, and `platform` namespaces. It intentionally contains no business tables.
- Security SQL after the generated table/index statements in `0002` is deliberately hand-authored. Drizzle checks table metadata; it does not regenerate or replace reviewed policies, context functions, ownership, or grants.

## Workflow for later modules

1. A feature agent adds or proposes schema in its owned module boundary and records the table ownership, tenant keys, RLS requirements, indexes, constraints, correction semantics, and migration dependencies in its handoff. It does not create a second migration directory or renumber an existing migration.
2. A0/integration reviews the proposal against the current `main` tip, assigns the next sequential migration number, and generates or integrates the migration into this directory. Existing migration files and Drizzle journal entries are immutable once merged.
3. A0 runs `pnpm format:check`, `pnpm db:check`, and a clean-database `pnpm db:migrate:test` before integration review. The integration suite then exercises the resulting PostgreSQL database using synthetic data only.
4. CI repeats the same sequence against its isolated PostgreSQL 16 service: `pnpm install --frozen-lockfile`, `pnpm db:migrate:test`, `pnpm db:check`, and `pnpm test:integration`. No developer Neon, staging, or production credential is required.
5. Concurrent module branches rebase or merge the latest `main` before integration review so A0 can resolve the single next migration number. A branch that is not yet integrated remains a proposal; it must not publish a competing production history.

The application path is server request/authentication → server-resolved tenant authority → application command/query service → repository/persistence adapter → `withTenantTransaction` → PostgreSQL. Browser code never imports this boundary, and repository work must not accept a client-selected tenant as authority or bypass the transaction context for tenant-owned reads/writes.
