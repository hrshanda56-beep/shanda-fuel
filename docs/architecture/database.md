# Database architecture

## A0 foundation

The server-only database boundary lives under `src/platform/db/`. Runtime queries use the pooled `DATABASE_URL`; direct migration commands use `DATABASE_DIRECT_URL` when configured and must never target production from local development.

The canonical migration history is `src/platform/db/migrations/` and is owned by A0/integration. The initial migration reserves the logical `auth`, `app`, and `platform` namespaces only. It intentionally creates no business tables.

`withTenantTransaction` requires tenant and actor context and sets transaction-local context keys. A1 owns the complete fail-closed PostgreSQL RLS implementation and the final runtime-role policy.

The target logical schemas are `auth`, `app`, and `platform`; the runtime must fail closed when tenant context is absent.
