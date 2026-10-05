# Stage 1 RLS/policy diagnostic

## Status and boundary

This is a diagnostic procedure for the unresolved Stage 1 production
RLS/policy preflight failure. It is not Stage 1, Stage 2, provisioning,
migration execution, or a repair procedure. It must not be run by an agent.

This procedure is currently blocked before catalog diagnostics. The
authoritative repository sources identify Neon as the production PostgreSQL
provider and PostgreSQL 18.6 as the recorded production version, but they do
not record an exact non-secret production database endpoint, host, project ID,
or database identifier. `APP_ENV`, `PGHOST`, and `PGDATABASE` are therefore
not independent production identity evidence. Human review is required before
an exact approved target invariant is added to the canonical operator tooling
and this procedure is re-reviewed.

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
process environment after the already-reviewed Stage 1 production bootstrap
described in [`DEC-011`](../DECISIONS.md) and
[`ARCHITECTURE.md §7.2`](../ARCHITECTURE.md#72-psql-16-compatibility). That
bootstrap parses the approved production URI and exports the decoded
`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and approved TLS
settings locally. This runbook does not parse a URI, accept a URI argument,
read a service file, or provide an alternative credential path.

`APP_ENV=production`, `PGSERVICE`, and `PGSERVICEFILE` are checked explicitly:
the production bootstrap must select the direct target through the reviewed
process-local variables, not opaque service indirection. `PGUSER` must be
`migration_owner`; `PGPASSWORD` must already be present through the approved
secret mechanism. `DATABASE_URL` and `DATABASE_DIRECT_URL` must be absent.

Until an authoritative non-secret production target invariant exists, do not
run the diagnostic command below. Its first SQL guard intentionally raises a
read-only error and stops before any catalog query. Do not substitute the
connection environment, `APP_ENV`, the migration hash, the provider
membership, or the PostgreSQL version for that missing invariant.

## Read-only command (currently blocked)

Run the following from the reviewed checkout. The command emits only catalog
metadata and error context; write its output, if retained, to an approved
secure evidence location outside the repository. Do not add a `--file`,
`--command`, or environment value containing the production URI or password.

```sh
set +x
set -euo pipefail

[[ "${APP_ENV:-}" == production ]] || {
  echo 'Refusing diagnostics unless APP_ENV=production.' >&2
  exit 1
}
[[ -z "${PGSERVICE:-}" && -z "${PGSERVICEFILE:-}" ]] || {
  echo 'Refusing opaque libpq service indirection; rerun the reviewed Stage 1 bootstrap.' >&2
  exit 1
}
: "${PGHOST:?PGHOST must already be set by the reviewed Stage 1 bootstrap}"
: "${PGPORT:?PGPORT must already be set by the reviewed Stage 1 bootstrap}"
: "${PGDATABASE:?PGDATABASE must already be set by the reviewed Stage 1 bootstrap}"
: "${PGUSER:?PGUSER must already be set by the reviewed Stage 1 bootstrap}"
[[ -n "${PGPASSWORD+x}" ]] || {
  echo 'Refusing diagnostics unless the approved secret mechanism injected PGPASSWORD.' >&2
  exit 1
}
[[ -n "$PGPASSWORD" ]] || {
  echo 'Refusing diagnostics unless the approved secret mechanism injected a non-empty PGPASSWORD.' >&2
  exit 1
}
[[ "$PGUSER" == migration_owner ]] || {
  echo 'Refusing diagnostics unless PGUSER=migration_owner.' >&2
  exit 1
}
[[ "$PGPORT" =~ ^[0-9]+$ && "$PGPORT" -ge 1 && "$PGPORT" -le 65535 ]] || {
  echo 'Refusing diagnostics for an invalid PGPORT.' >&2
  exit 1
}
case "$PGHOST" in
  postgresql://*|postgres://*)
    echo 'Refusing URI-valued PGHOST; rerun the reviewed Stage 1 bootstrap.' >&2
    exit 1
    ;;
esac
case "$PGDATABASE" in
  postgresql://*|postgres://*)
    echo 'Refusing URI-valued PGDATABASE; rerun the reviewed Stage 1 bootstrap.' >&2
    exit 1
    ;;
esac

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
  IF current_user <> 'migration_owner' OR session_user <> 'migration_owner' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Intentional diagnostic refusal: current_user and session_user must both be migration_owner',
      HINT = 'This is not the original Stage 1 division-by-zero failure.';
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'Intentional wrong-target refusal: no authoritative non-secret production database target invariant is recorded',
    HINT = 'Human review must establish the approved target invariant before catalog diagnostics are enabled. This is not the original Stage 1 division-by-zero failure.';
END
$$;

-- The intentional guard above must be replaced only after an authoritative
-- non-secret production target invariant is recorded and independently
-- reviewed. The accepted fingerprint and policy catalog queries remain below
-- as the diagnostic payload for that future, separately reviewed procedure;
-- ON_ERROR_STOP=1 makes them unreachable while this guard is present. The
-- future target guard must retain the exact production invariant
-- server_version_num = 180006; the version is only defence in depth, not
-- independent target identity.
SELECT current_user, session_user, current_database(), current_setting('server_version_num') AS server_version_num,
       current_setting('server_version') AS server_version,
       current_setting('transaction_read_only') AS transaction_read_only;

SELECT count(*) = 1 AS migration_fingerprint_present
  FROM drizzle.__drizzle_migrations
 WHERE hash = 'a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa';

SELECT EXISTS (
  SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
   WHERE granted_role.rolname = 'first_user_provisioner'
     AND member_role.rolname = 'migration_owner'
     AND grantor_role.rolname = 'cloud_admin'
     AND membership.admin_option
     AND NOT membership.inherit_option
     AND NOT membership.set_option
) AS approved_provider_membership;

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
