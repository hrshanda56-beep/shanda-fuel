# Stage 1 RLS/policy diagnostic

## Status and boundary

This is a diagnostic procedure for the unresolved Stage 1 production
RLS/policy preflight failure. It is not Stage 1, Stage 2, provisioning,
migration execution, or a repair procedure. It must not be run by an agent.

The repository contains the reviewed migration and first-user helper checks,
but it does not contain the operator-side Stage 1 policy assertion that
reported `ERROR: division by zero`. The missing evidence is therefore:

1. the exact operator-side SQL statement or script line that raised the error;
2. its PostgreSQL SQLSTATE, detail, hint, and context with `VERBOSITY=verbose`;
3. the non-secret policy-catalog result used by that assertion.

Until those three items are available, production drift and a tooling/assertion
defect cannot be distinguished safely.

## Preconditions

Only an approved human operator may run this procedure against the approved
production database. The operator must use the exact reviewed Stage 1 checkout
and the existing approved connection setup. The database credential must be
loaded through the approved hidden-input/secret-manager path into libpq
environment or service configuration; it must not appear in a command
argument, file, chat message, log, or evidence bundle.

The procedure requires libpq connection settings already present in the
process environment (`PGSERVICE`, or `PGHOST`, `PGPORT`, `PGDATABASE`, and
`PGUSER`, with the password supplied through the approved secret mechanism).
It deliberately does not accept a database URI argument. Before execution,
the operator must confirm that no `DATABASE_URL` or `DATABASE_DIRECT_URL`
value will be passed to `psql` or written to evidence.

## Read-only command

Run the following from the reviewed checkout. The command emits only catalog
metadata and error context; write its output, if retained, to an approved
secure evidence location outside the repository. Do not add a `--file`,
`--command`, or environment value containing the production URI or password.

```sh
set -euo pipefail

if [[ -z "${PGSERVICE:-}" ]]; then
  : "${PGHOST:?PGHOST must already be securely configured}"
  : "${PGDATABASE:?PGDATABASE must already be securely configured}"
  : "${PGUSER:?PGUSER must already be securely configured}"
fi

if [[ -n "${DATABASE_URL:-}" || -n "${DATABASE_DIRECT_URL:-}" ]]; then
  echo 'Refusing URI-valued database environment variables for this diagnostic.' >&2
  exit 1
fi

export PGAPPNAME=shanda-fuel-stage1-rls-policy-diagnostic
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000'

psql --no-password -X \
  --set=ON_ERROR_STOP=1 \
  --set=VERBOSITY=verbose \
  --set=SHOW_CONTEXT=always \
  --pset=pager=off <<'SQL'
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF current_user <> 'migration_owner' THEN
    RAISE EXCEPTION 'Stage 1 policy diagnostics require migration_owner';
  END IF;
END
$$;

SELECT current_user, current_database(), current_setting('transaction_read_only') AS transaction_read_only;

WITH expected(schema_name, table_name) AS (
  VALUES
    ('app', 'tenants'),
    ('app', 'legal_entities'),
    ('app', 'stations'),
    ('app', 'memberships'),
    ('app', 'membership_role_assignments'),
    ('app', 'temporary_permission_grants'),
    ('platform', 'security_events'),
    ('platform', 'first_user_provisioning_operations'),
    ('platform', 'first_user_provisioning_operation_grants')
)
SELECT e.schema_name,
       e.table_name,
       c.relrowsecurity,
       c.relforcerowsecurity
  FROM expected e
  LEFT JOIN pg_namespace n ON n.nspname = e.schema_name
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
 ORDER BY e.schema_name, e.table_name;

WITH expected(schema_name, table_name) AS (
  VALUES
    ('app', 'tenants'),
    ('app', 'legal_entities'),
    ('app', 'stations'),
    ('app', 'memberships'),
    ('app', 'membership_role_assignments'),
    ('app', 'temporary_permission_grants'),
    ('platform', 'security_events'),
    ('platform', 'first_user_provisioning_operations'),
    ('platform', 'first_user_provisioning_operation_grants')
)
SELECT p.schemaname,
       p.tablename,
       p.policyname,
       p.permissive,
       p.roles,
       p.cmd,
       p.qual,
       p.with_check
  FROM pg_policies p
  JOIN expected e ON e.schema_name = p.schemaname AND e.table_name = p.tablename
 ORDER BY p.schemaname, p.tablename, p.policyname;

ROLLBACK;
SQL
```

`default_transaction_read_only=on` and `BEGIN TRANSACTION READ ONLY` are
defence in depth. `ON_ERROR_STOP=1` makes any error—including a diagnostic
query error—a hard stop; the procedure must not continue to Stage 1, Stage 2,
credential assignment, or provisioning after a failure.

## Required evidence and stop rule

The operator should return only the redacted command output and the exact
failing Stage 1 statement/line, with secrets, connection details, tenant
business data, and credentials removed. If the original Stage 1 assertion is
not available, the policy catalog above is still useful but is insufficient to
establish the root cause.

No role, ACL, policy, RLS flag, migration, schema, data, password, or
configuration may be changed as part of this procedure. A successful
diagnostic does not make Stage 1 pass and does not authorise a rerun or Stage 2.
