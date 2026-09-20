# Database security

The target database design uses separate `auth`, `app`, and `platform` schemas, tenant-aware foreign keys, PostgreSQL RLS, and a tenant transaction wrapper that sets local tenant and actor context before business queries execute.

## A1 security boundary

- Better Auth is the server-side identity/session boundary. The Next.js route at `/api/auth/[...all]` delegates to the server-only Better Auth configuration, uses the Drizzle PostgreSQL adapter in the `auth` schema, and fails closed when `BETTER_AUTH_SECRET` is absent. Browser code never receives database credentials or connects to PostgreSQL.
- Auth core tables (`user`, `session`, `account`, and `verification`) are separate from tenant memberships. A membership links an identity to a tenant and is usable only while its status is `ACTIVE`; `INVITED`, `SUSPENDED`, `LOCKED`, and `DISABLED` are denied by the application guard.
- Application code validates UUID-shaped tenant, actor, membership, legal-entity and station identifiers before opening a transaction.
- `withTenantTransaction` sets all context keys with `SET LOCAL` semantics, including empty values for omitted optional scope, so pooled connections cannot retain a previous request's context.
- RLS policies use `app.current_tenant_id()` and fail closed when the setting is missing or malformed. Tenant-owned children repeat `tenant_id` in composite foreign keys.
- The runtime role is not a schema owner and must not have `BYPASSRLS`; migration ownership remains separate. Background jobs use the same tenant-context path.
- `platform.security_events` is tenant-scoped and append-oriented: ordinary runtime roles do not receive update/delete permission. Events are independently HMAC signed with a key identifier; there is no global hash chain bottleneck.
- Environment bootstrap provisions separate `migration_owner`, `app_runtime`, `job_runtime`, and `diagnostics_readonly` roles. Runtime roles are `NOSUPERUSER`, `NOBYPASSRLS`, and not schema owners; no application path relies on `SECURITY DEFINER`. The integration test creates a dedicated non-bypass runtime role to prove the same boundary.

The migration-ready A1 proposal is [`architecture/a1-platform-security-migration.sql`](architecture/a1-platform-security-migration.sql). It is deliberately not in the canonical migration directory; A0 must review and integrate its ordered migration before deployment.
