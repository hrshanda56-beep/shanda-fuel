# Database security

The target database design uses separate `auth`, `app`, and `platform` schemas, tenant-aware foreign keys, PostgreSQL RLS, and a tenant transaction wrapper that sets local tenant, actor, and membership context before business queries execute.

## A1 security boundary

- Better Auth is the server-side identity/session boundary. The Next.js route at `/api/auth/[...all]` delegates to the server-only Better Auth configuration, uses the Drizzle PostgreSQL adapter in the `auth` schema, and fails closed when `BETTER_AUTH_SECRET` is absent. Browser code never receives database credentials or connects to PostgreSQL.
- Auth core tables (`user`, `session`, `account`, and `verification`) are separate from tenant memberships. A membership links an identity to a tenant and is usable only while its status is `ACTIVE`; `INVITED`, `SUSPENDED`, `LOCKED`, and `DISABLED` are denied by the application guard.
- The trusted path is Better Auth session → server-resolved identity → requested tenant lookup → persisted membership and status → role/grant scope → branded server-owned execution context → tenant transaction → RLS. A requested tenant UUID is intent only; it cannot establish authority.
- `withTenantTransaction` accepts only a branded context created by the authority resolver. It sets all context keys with `SET LOCAL` semantics, including membership, so pooled connections cannot retain a previous request's context.
- RLS policies use `app.current_tenant_id()`, `app.current_actor_id()`, `app.current_membership_id()`, and `app.has_active_membership()`, and fail closed when any required context is missing or malformed. Tenant-owned children repeat `tenant_id` in composite foreign keys.
- The runtime role is not a schema owner and must not have `BYPASSRLS`; migration ownership remains separate. Background jobs use the same tenant-context path.
- `platform.security_events` is intentionally tenant-scoped: `tenant_id` is required and protected by tenant-aware foreign keys and RLS. Login, MFA, recovery, and other pre-tenant identity events need a separately designed global stream; they must not be represented here through nullable tenant IDs. Tenant events are independently HMAC signed with a key identifier; there is no global hash chain bottleneck.
- [`ops/db/bootstrap.sql`](../ops/db/bootstrap.sql) provisions separate `migration_owner`, `app_runtime`, `job_runtime`, and `diagnostics_readonly` roles. Runtime roles are `NOSUPERUSER`, `NOBYPASSRLS`, and not schema owners. Integration tests use those exact role contracts after a fresh canonical migration. `SECURITY DEFINER` is permitted only for the narrow, explicitly reviewed authoritative capabilities described in [A3 forecourt `SECURITY DEFINER` capabilities](#a3-forecourt-security-definer-capabilities) below -- it is not a general-purpose escape hatch, and no other application path relies on it.
- Runtime/job roles receive INSERT (and only the required tenant SELECT) for security events, never UPDATE or DELETE. The append API accepts the active transaction executor so tenant-local RLS context is preserved.
- Membership revocation denies new authority immediately, filters revoked/expired temporary grants, and the migration proposal revokes active grants on status transitions. Strong-authentication gates require a verified server-side assertion; absent verification fails closed. Public Better Auth signup is disabled and authentication alone never creates tenant access.
- Production environment validation requires an HTTPS `APP_URL`, a database, and a Better Auth secret; secure cookies are enabled for production.

## A3 forecourt `SECURITY DEFINER` capabilities

`SECURITY DEFINER` is used in `src/platform/db/migrations/0003_a3_forecourt_reconciliation.sql` for a small, named set of authoritative forecourt capabilities that the `app_runtime` role must invoke but must not be able to perform through an ordinary table `UPDATE`/`INSERT`. This is a deliberate, reviewed exception to the general rule above, not a broad pattern -- each definition is scoped as narrowly as the specific transition it authorizes:

- `app.seal_meter_segment(tenant_id, station_id, segment_id, expected_version)` -- the sole OPEN → SEALED transition for a meter segment.
- `app.resolve_meter_exception(tenant_id, station_id, exception_id, resolution_boundary_id, resolution_kind, ...)` -- the sole resolution path for a blocking meter-unavailable exception.
- `app.create_meter_exception_for_unavailable_boundary()` -- an `AFTER INSERT` trigger on `app.meter_boundaries` that creates the immutable exception fact when a boundary reading is `UNAVAILABLE`.

Controls actually present in the migration for each capability:

- **Minimal scope**: each function performs exactly one authoritative state transition (or, for the trigger, one deterministic insert derived from `NEW`) and nothing else.
- **Fixed, safe `search_path`**: `seal_meter_segment`, `resolve_meter_exception`, and `create_meter_exception_for_unavailable_boundary` all declare `SET search_path = pg_catalog, app`, so they cannot be redirected by a session-level `search_path` change.
- **No arbitrary dynamic SQL**: every statement is a literal, parameterized `SELECT`/`UPDATE`/`INSERT` against a fixed table; there is no `EXECUTE`/`format()`-built SQL inside any of these functions.
- **PUBLIC `EXECUTE` revoked, explicit intended-role grant**: `seal_meter_segment` and `resolve_meter_exception` both `REVOKE ALL ... FROM PUBLIC` and then `GRANT EXECUTE ... TO app_runtime` only. `create_meter_exception_for_unavailable_boundary` is a trigger function; it is never granted `EXECUTE` directly and runs only when a role with `INSERT` on `app.meter_boundaries` (i.e. `app_runtime`) fires the trigger.
- **Explicit tenant/station/session validation**: `seal_meter_segment` and `resolve_meter_exception` both check `session_user IN ('app_runtime', 'postgres')`, that `app.current_tenant_id()` matches the requested tenant, that `app.station_id` is a well-formed UUID matching the requested station, and that `app.has_active_membership()` is true -- they fail closed if the trusted station context is missing or forged. `create_meter_exception_for_unavailable_boundary` relies on the RLS-protected, trigger-derived `NEW` row rather than caller-supplied identifiers, since it has no independent input surface.
- **Non-owner, `NOBYPASSRLS` runtime role**: all three functions are owned by `migration_owner` (not `app_runtime`), so `app_runtime` gains only the single authorized transition, never blanket table privileges; `app_runtime` itself remains `NOSUPERUSER`/`NOBYPASSRLS`.
- **RLS/`FORCE ROW LEVEL SECURITY` as defense in depth**: `app.meter_segments`, `app.meter_boundaries`, and `app.meter_exceptions` all have RLS enabled and forced with the standard tenant-context policy, so even a direct `UPDATE` attempt by `app_runtime` (which lacks the `UPDATE` grant in the first place) would additionally be constrained by tenant scope.

This is the accurate, verified invariant: `SECURITY DEFINER` is permitted for narrow, explicitly reviewed authoritative capabilities with the controls above, not a general escape from the RLS/role model described in the A1 section.

## A2 integration seam

A2 should consume typed capability/navigation projections generated by server authorization. Client/design-system code must not evaluate raw permission rules. The intended flow is canonical permission code → server authorization → typed UI capability projection → A2 rendering.

The canonical history is `src/platform/db/migrations/0000_platform_namespaces.sql`, `0001_a1_auth_identity.sql`, `0002_a1_tenant_authorization_security.sql`, and `0003_a3_forecourt_reconciliation.sql`. [`architecture/a1-platform-security-migration.sql`](architecture/a1-platform-security-migration.sql) remains documentation/reference only and is never executed by tests or deployment.
