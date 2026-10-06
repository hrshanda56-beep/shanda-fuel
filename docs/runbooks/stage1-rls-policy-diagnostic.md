# Stage 1 RLS/policy diagnostic

## Status and boundary

This is a diagnostic procedure for the unresolved Stage 1 production
RLS/policy preflight failure. It is not Stage 1, Stage 2, provisioning,
migration execution, or a repair procedure. It must not be run by an agent.

The human-approved independent production target invariant is now recorded in
DEC-031 and incorporated below. The approved endpoint is the exact host
`ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech`; the provider
project, branch, endpoint, and region identifiers are recorded as provenance.
The shell guard compares the decoded process-local `PGHOST` from the reviewed
DEC-011 bootstrap against that repository-controlled value before `psql` can
execute. This procedure remains a human-run, read-only diagnostic and has not
been executed against production.

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

The shell guard rejects any empty or non-exact `PGHOST` before `psql` starts.
Do not substitute `APP_ENV`, `PGDATABASE`, the migration hash, the provider
membership, or the PostgreSQL version for the independent endpoint invariant.

The approved non-secret provider provenance is recorded in DEC-031:

- Neon project `shanda-fuel-production` / `plain-paper-48449309`;
- primary branch `main` / `br-morning-dust-b270y3ry`;
- endpoint `ep-polished-haze-b29kd207`;
- region `aws-eu-central-1`.

## Read-only command (human execution only)

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
[[ -z "${PGHOSTADDR+x}" ]] || {
  echo 'Refusing PGHOSTADDR override; rerun the reviewed Stage 1 bootstrap.' >&2
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
readonly APPROVED_PRODUCTION_HOST='ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech'
[[ "$PGHOST" == "$APPROVED_PRODUCTION_HOST" ]] || {
  echo 'Refusing diagnostics: PGHOST is not the approved production endpoint.' >&2
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

  IF current_setting('server_version_num') <> '180006' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Intentional diagnostic refusal: server_version_num is not the approved PostgreSQL 18.6 value',
      HINT = 'This is not the original Stage 1 division-by-zero failure.';
  END IF;
END
$$;

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

The migration fingerprint and provider-membership queries are intentionally
diagnostic observations, not additional SQL assertions. A `false` result is
evidence to return and classify; it does not itself produce a nonzero exit or
skip the catalog queries. The RLS/FORCE-RLS relation query and policy catalog
query have the same observation-only semantics: missing, unexpected, or
different rows are collected for diagnosis rather than converted into a new
assertion by this procedure. A query error, the explicit identity/version
refusal, or any shell pre-connect guard failure remains fail-closed and
nonzero under `ON_ERROR_STOP=1` and `set -e`.

## Required evidence and stop rule

The operator should return only the redacted command output and the exact
failing Stage 1 statement/line, with secrets, connection details, tenant
business data, and credentials removed. The operator must report false
fingerprint or membership observations and unexpected RLS/FORCE-RLS or policy
catalog contents as evidence; they are not immediate shell-stop conditions in
this observation-only procedure. If the original Stage 1 assertion is not
available, the policy catalog above is still useful but is insufficient to
establish the root cause.

Exit status zero means only that the guarded, read-only evidence collection
completed without a shell or SQL error. It does not mean that every observed
fingerprint, membership, RLS/FORCE-RLS, or policy result matched expectation,
and it does not mean that Stage 1 passed.

No role, ACL, policy, RLS flag, migration, schema, data, password, or
configuration may be changed as part of this procedure. A successful
diagnostic does not make Stage 1 pass and does not authorise a rerun or Stage 2.
