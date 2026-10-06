# Deployment runbook

## Release preflight

1. Confirm the release commit, CI run, approved change record, backup freshness,
   and the staging evidence in [`../release-readiness.md`](../release-readiness.md).
2. Complete [`production-configuration.md`](production-configuration.md) and
   record provider/operator evidence separately. Confirm that production uses
   separate Vercel/Neon/R2/auth secrets and HTTPS. Do not copy staging data or
   credentials into production.
3. Confirm the separate database role topology below. If it cannot be
   established, stop deployment; do not weaken RLS or use one shared role.

## Initial managed PostgreSQL provisioning

1. Use a Neon/provider owner or deployment-admin connection. Do not use the application runtime credential for role creation or ownership changes.
2. Run [`ops/db/bootstrap.sql`](../../ops/db/bootstrap.sql) with `ON_ERROR_STOP=1`. It creates `migration_owner`, `app_runtime`, `job_runtime`, and `diagnostics_readonly` with `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, and `NOINHERIT`.
3. Inject credentials through the provider secret manager and grant `LOGIN` only to the roles that must connect. No passwords are stored in this repository. The application uses `app_runtime`; background workers use `job_runtime`; diagnostics use `diagnostics_readonly`; migrations use a direct owner/admin path that can act as `migration_owner`.
4. Apply canonical migrations in order through `0020_security_runtime_least_privilege_rate_limit`. Confirm the protected schemas/tables are owned by `migration_owner`, runtime roles are not owners, and the runtime-role proof passes.
5. Set `DATABASE_URL` to the pooled runtime connection and keep `DATABASE_DIRECT_URL` restricted to migration/deployment automation. Never start the application with migration-owner credentials.

Neon provisioning may require its project owner/admin connection for `CREATE ROLE`, `ALTER ROLE`, and ownership reassignment. Treat inability to establish the four-role topology as a deployment blocker; do not weaken the migration or grant model to accommodate a single shared application role.

## Temporary first-user credential authority

The bootstrap contract intentionally leaves `migration_owner` as
`NOCREATEROLE`. On PostgreSQL 18.6, its reviewed `ADMIN` membership over
`first_user_provisioner` does not authorize `ALTER ROLE ... PASSWORD`.

Therefore the temporary `first_user_provisioner` password must remain at the
existing human/provider-owner or deployment-admin boundary used for initial
managed-PostgreSQL role operations. This is a one-time, operator-controlled
assignment and matching cleanup only; it is not a new application connection
class or a persistent elevated credential.

The human-only sequence, once the operator helper has received a separate
reviewed implementation, is:

1. Run the reviewed Stage 1 migration-owner preflight and stop before any
   provisioner session. Confirm the role is still `PASSWORD NULL` and all
   security checks pass.
2. Through the existing provider/deployment-admin secret-handling workflow,
   enter the temporary password without putting its URL/password in argv,
   files, chat, or logs, and execute only the approved role-password
   assignment for `first_user_provisioner`.
3. Run the reviewed direct `first_user_provisioner` read-only scope checks.
   Do not run Stage 2 or provisioning from this sequence.
4. Through the same approved authority boundary, execute only
   `ALTER ROLE first_user_provisioner PASSWORD NULL;`, then verify the
   password is unusable and the role attributes, membership, ownership, and
   ACL invariants remain exact.

Do not grant `CREATEROLE` to `migration_owner`, use `cloud_admin` or
`neon_superuser` as an application/bootstrap shortcut, add a persistent
privileged credential, or create a new SECURITY DEFINER password function.
The current external Stage 1 helper still attempts assignment through
`migration_owner`; it must not be rerun until its replacement or narrowly
reviewed authority handoff is complete.

## Deploy and verify

1. Deploy the immutable application build through the approved hosting control
   plane. Do not run migrations from the browser or application startup.
2. Apply canonical migrations only through the restricted direct migration path
   and record the migration result. Migrations are forward-only; do not invent
   or run down-migrations during release operations.
3. Check `/api/health` and `/api/readiness`, then run the approved authenticated
   smoke and permission-denial checks. Keep tenant, station, and financial
   data synthetic until pilot approval.
4. Watch errors, latency, database connectivity, audit/security events, and
   provider/storage signals for the agreed observation window. Record the
   deployment ID, commit, migration state, and operator sign-off.

## Rollback

### Application-only rollback

If the application is defective and the database remains compatible, repoint
traffic to the last known-good immutable deployment. Confirm compatibility
before doing so, and rerun health/readiness plus affected workflow checks. Do
not reset Git, rewrite history, or reverse a migration.

### Database/data incident

If the issue is database availability, incompatible schema/data, or broad
corruption, stop and use [`backup-restore.md`](backup-restore.md) and
[`incident-response.md`](incident-response.md). A restore requires the incident
owner and database/provider owner; it is not an application rollback. Use
named domain correction/reversal commands for posted records rather than direct
SQL edits.
