# Stage 1 RLS/policy diagnostic

## Status and boundary

This is a diagnostic procedure for the unresolved Stage 1 production
RLS/policy preflight failure. It is not Stage 1, Stage 2, provisioning,
migration execution, or a repair procedure. It must not be run by an agent.

The human-approved independent production target invariant is now recorded in
DEC-031 and incorporated below. The approved endpoint is the exact host
`ep-polished-haze-b29kd207.c-6.eu-central-1.aws.neon.tech`; the provider
project, branch, endpoint, and region identifiers are recorded as provenance.
The repository-local runner compares the decoded host inside the reviewed
DEC-011 parsing path against that repository-controlled value before `psql`
can execute. This procedure remains a human-run, read-only diagnostic. The
earlier version was executed by the approved human operator; this updated
predicate-level evidence procedure has now been executed against production by
the approved human operator; agents must not execute it.

The exact historical policy assertion is reconstructed from the approved local
operator tooling at `/Users/wolftech/.codex/phase0/production-dry-run-stage1.sh`,
around lines 485–513. Its two predicates were:

1. exactly nine target-relation rows named
   `first_user_provisioning_definer` with `cmd='*'` and exact
   `qual`/`with_check` text `(CURRENT_USER = 'migration_owner'::name)`;
2. no policy anywhere in `pg_policies` whose name matches
   `first_user_provisioning_%`, other than that expected policy name.

The first predicate contained the confirmed operator/preflight defect. It
queried the normalized `pg_policies.cmd` column but compared it with the raw
`pg_policy.polcmd` representation `'*'`. PostgreSQL exposes an ALL policy as
`pg_policy.polcmd='*'` and `pg_policies.cmd='ALL'`. The corrected predicate is
therefore the same predicate with `pg_policies.cmd = 'ALL'`; its exact
qualifying expression, with-check expression, target relation set, and global
unexpected-name check are unchanged. The repository-local diagnostic uses this
corrected normalized comparison. The immutable external helper is not modified
by this branch; its approved operator-tool owner must apply this one-line
correction before a human rerun.

The updated diagnostic returns each predicate, the final `policy_checks_ok`
conjunction, all globally matching policy rows, complete target rows, and
normalized `pg_policies` text alongside the underlying `pg_policy` node-tree
representation. It does not rerun the historical assertion or execute its
division-by-zero failure branch.

## Preconditions

Only an approved human operator may run this procedure against the approved
production database. The operator must use the exact reviewed Stage 1 checkout
and the existing approved connection setup. The database credential must be
loaded through the approved hidden-input/secret-manager path into
`SF_MIGRATION_OWNER_DB_URL`; it must not appear in a command argument, file,
chat message, log, or evidence bundle.

The approved DEC-011 bootstrap places the production URI only in
`SF_MIGRATION_OWNER_DB_URL` in the operator's process environment. It does not
export decoded `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, or `PGPASSWORD` into
the parent shell. Do not manually parse the URI or export decoded secrets.

This runbook uses the repository-local diagnostic runner
[`scripts/production/stage1-rls-policy-diagnostic.mjs`](../../scripts/production/stage1-rls-policy-diagnostic.mjs).
The runner intentionally reproduces the reviewed DEC-011 URL-parser and
child-only libpq-environment semantics for this diagnostic path. It asserts
the decoded host before spawning `psql`, removes inherited URI/libpq variables
from the child, and sets only the decoded connection values required by
libpq. The URI and password never appear in argv, files, or output.

`APP_ENV=production` is a precondition only; it is not the production identity
invariant. The runner's exact approved decoded-host assertion is the
independent target check. The runner also rejects a URI `hostaddr` override so
the actual socket cannot be redirected away from the approved host.

The approved non-secret provider provenance is recorded in DEC-031:

- Neon project `shanda-fuel-production` / `plain-paper-48449309`;
- primary branch `main` / `br-morning-dust-b270y3ry`;
- endpoint `ep-polished-haze-b29kd207`;
- region `aws-eu-central-1`.

## Read-only command (human execution only)

Run the following from the reviewed checkout. The command emits only catalog
metadata and error context; write its output, if retained, to an approved
secure evidence location outside the repository. Do not add arguments,
`--file`, `--command`, or environment values containing the production URI or
password. The runner supplies the fixed diagnostic SQL; it does not invoke the
Stage 1 script, Stage 2, provisioning, or any password-assignment path.

```sh
set +x
set -euo pipefail

[[ "${APP_ENV:-}" == production ]] || {
  echo 'Refusing diagnostics unless APP_ENV=production.' >&2
  exit 1
}
[[ -n "${SF_MIGRATION_OWNER_DB_URL:-}" ]] || {
  echo 'Refusing diagnostics unless the approved DEC-011 bootstrap provided SF_MIGRATION_OWNER_DB_URL.' >&2
  exit 1
}

exec node scripts/production/stage1-rls-policy-diagnostic.mjs
```

The runner invokes `psql` with `-X`, `-w`, `ON_ERROR_STOP=1`, verbose error
context, and pager-off settings. It passes the decoded libpq environment only
to that child process, forces `PGOPTIONS` to
`default_transaction_read_only=on`, and supplies the fixed SQL payload that
begins with `BEGIN TRANSACTION READ ONLY` and ends with `ROLLBACK`.

`default_transaction_read_only=on` and `BEGIN TRANSACTION READ ONLY` are
defence in depth. `ON_ERROR_STOP=1` makes any error—including a diagnostic
query error—a hard stop; the procedure must not continue to Stage 1, Stage 2,
credential assignment, or provisioning after a failure.

The migration fingerprint and provider-membership queries are intentionally
diagnostic observations, not additional SQL assertions. A `false` result is
evidence to return and classify; it does not itself produce a nonzero exit or
skip the catalog queries. The RLS/FORCE-RLS relation query and policy catalog
queries have the same observation-only semantics. The policy evidence includes
the historical subconditions and final boolean, but does not convert a false
value into a new failure. A query error, the explicit identity/version
refusal, or any shell pre-connect guard failure remains fail-closed and
nonzero under `ON_ERROR_STOP=1` and `set -e`.

## Required evidence and stop rule

The operator should return only the redacted command output and the exact
failing Stage 1 statement/line, with secrets, connection details, tenant
business data, and credentials removed. Include the three policy booleans,
their counts, every globally matching `first_user_provisioning_%` row, the
complete relevant `pg_policies` rows, and the raw/normalized policy fields.
The operator must report false fingerprint or membership observations and
unexpected RLS/FORCE-RLS or policy-catalog contents as evidence; they are not
immediate shell-stop conditions in this observation-only procedure. Do not
rerun Stage 1, Stage 2, provisioning, or any mutation.

Exit status zero means only that the guarded, read-only evidence collection
completed without a shell or SQL error. It does not mean that every observed
fingerprint, membership, RLS/FORCE-RLS, or policy result matched expectation,
and it does not mean that Stage 1 passed.

No role, ACL, policy, RLS flag, migration, schema, data, password, or
configuration may be changed as part of this procedure. A successful
diagnostic does not make Stage 1 pass and does not authorise a rerun or Stage 2.

## Human-approved Stage 1 rerun procedure after required correction

The root cause is verified, but the rerun is not currently safe. The immutable
external helper must first contain this exact correction in its historical
`pg_policies` assertion:

```sql
-- corrected normalized representation
AND cmd = 'ALL'
```

Do not run the unchanged helper: its `AND cmd = '*'` comparison is the defect
that caused the false policy failure. After the operator-tool owner has applied
and independently reviewed that one-line change, the human operator may use
the existing approved DEC-011 bootstrap and run the helper from its reviewed
location with tracing disabled:

```sh
set +x
exec /Users/wolftech/.codex/phase0/production-dry-run-stage1.sh
```

This is a human-controlled Stage 1 rerun procedure, not an instruction for an
agent. The human must stop at the helper's existing scope-discovery hard stop;
do not continue to Stage 2, real provisioning, or any remediation. The
existing helper owns its temporary credential cleanup. No URI, password, or
other secret may be placed in argv, files, logs, chat, or returned evidence.
