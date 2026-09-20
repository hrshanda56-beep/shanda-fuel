# Deployment runbook

## Initial managed PostgreSQL provisioning

1. Use a Neon/provider owner or deployment-admin connection. Do not use the application runtime credential for role creation or ownership changes.
2. Run [`ops/db/bootstrap.sql`](../../ops/db/bootstrap.sql) with `ON_ERROR_STOP=1`. It creates `migration_owner`, `app_runtime`, `job_runtime`, and `diagnostics_readonly` with `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, and `NOINHERIT`.
3. Inject credentials through the provider secret manager and grant `LOGIN` only to the roles that must connect. No passwords are stored in this repository. The application uses `app_runtime`; background workers use `job_runtime`; diagnostics use `diagnostics_readonly`; migrations use a direct owner/admin path that can act as `migration_owner`.
4. Apply canonical migrations in order: `0000_platform_namespaces`, `0001_a1_auth_identity`, `0002_a1_tenant_authorization_security`. Confirm the protected schemas/tables are owned by `migration_owner` and that the runtime roles are not owners.
5. Set `DATABASE_URL` to the pooled runtime connection and keep `DATABASE_DIRECT_URL` restricted to migration/deployment automation. Never start the application with migration-owner credentials.

Neon provisioning may require its project owner/admin connection for `CREATE ROLE`, `ALTER ROLE`, and ownership reassignment. Treat inability to establish the four-role topology as a deployment blocker; do not weaken the migration or grant model to accommodate a single shared application role.
