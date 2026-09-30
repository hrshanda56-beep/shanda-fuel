# Integrated staging recovery rehearsal

## Scope and safety boundary

This procedure composes the existing Neon isolated-restore work, the existing
read-only staging verifier, and the existing R2 retained-copy drill. It is an
evidence-producing rehearsal only. It must never restore over production, use a
production application URL, or use production credentials.

The repository command fails closed unless all of the following are explicit:

- `APP_ENV=staging`;
- `--environment staging` and `--target-label isolated-staging`;
- an HTTPS recovery application origin with no credentials, path, query, or
  fragment;
- a PostgreSQL recovery URL that does not resemble a production target;
- distinct Tenant A and Tenant B UUIDs and stations; and
- the explicit confirmation flag.

The session cookie, database URL, and R2 credentials are read from environment
or the approved secret manager and are never printed or written to evidence.
If the isolated staging deployment has Vercel Deployment Protection enabled,
securely inject `VERCEL_AUTOMATION_BYPASS_SECRET` through the approved secret
mechanism before execution. The verifier reads it only from the process
environment and sends it only as the protection-bypass request header; never
place it in a command argument, URL, shell assignment, evidence, or log.

The launch targets are RPO ≤ 15 minutes and RTO ≤ 4 hours. The rehearsal
retains measured RPO and RTO values, including when either target is missed;
overall success requires both targets and all three recovery validations.

## Provider/operator prerequisites

The recovery owner must prepare these items before the rehearsal:

1. An independent staging logical backup using
   [`scripts/db/create-staging-logical-backup.sh`](../../scripts/db/create-staging-logical-backup.sh),
   or an approved Neon/provider backup export. Keep the dump outside the
   application bucket and retain its manifest and checksum. The `pg_dump` and
   `pg_restore` client major must be compatible with the staging database
   server major. During the 2026-09-30 rehearsal, the staging server reported
   PostgreSQL 18.6 and the successful Docker client was `postgres:18`. This is
   verified rehearsal evidence, not a permanent infrastructure assumption;
   recheck the server major before future runs. `postgres:16` is not a valid
   client for the current staging server.
2. A temporary, isolated Neon staging branch/restore target. The provider
   operator records the provider recovery-through timestamp; the application
   must not point normal staging traffic at this target.
3. An isolated staging deployment configured against that restored database,
   with `APP_ENV=staging` and the target label `isolated-staging`. The
   deployment must expose the existing `/api/health`, `/api/readiness`, and
   tenant-scoped read-only operations check.
4. Two non-production tenant/station contexts and a read-only authenticated
   staging session. Tenant A must be present in the restored data; Tenant B is
   the negative-control tenant. Do not copy unrelated tenant data into the
   evidence case.
5. The R2 recovery-bucket controls and credentials described in
   [`r2-object-recovery.md`](r2-object-recovery.md).

The database check uses a read-only PostgreSQL transaction. The application
check uses only the existing GET/HEAD verifier, and the R2 phase uses the
existing guarded synthetic-object drill. No financial posting, migration,
repair command, or production write is part of this rehearsal.

This is an operational composition rather than a new recovery architecture.
The provider remains responsible for creating/restoring the isolated Neon
target, supplying the recovered-through timestamp, and controlling retention
and cleanup. The repository deliberately adds no provider-specific restore API,
production access, tenant repair command, or replacement storage recovery
implementation. The resulting evidence complements provider-console evidence
for branch identity, Bucket Lock, lifecycle, and retention; it does not replace
that evidence.

## Exact later staging procedure

Run from the reviewed repository commit on a trusted operator shell. Before
executing either block, securely inject/export all required secrets through the
approved secret manager. Do not assign database URLs, session cookies, R2
credentials, or other secret values in shell history. The blocks below only
validate that already-injected values exist. Use a secure evidence directory
outside the repository.

```sh
: "${APP_ENV:?APP_ENV must already be set to staging}"
: "${RECOVERY_APP_URL:?Set the isolated staging HTTPS origin before execution}"
: "${RECOVERY_LAST_KNOWN_GOOD_AT:?Set the UTC known-good timestamp before execution}"
: "${RECOVERY_EVIDENCE_DIR:?Set a secure evidence directory before execution}"
[[ "$APP_ENV" == staging ]] || { echo "APP_ENV must be staging." >&2; exit 1; }
mkdir -p "$RECOVERY_EVIDENCE_DIR"

# Optional repository-prepared independent logical backup, before the restore.
# Configure libpq through the approved secret mechanism before this command:
# PGSERVICE/PGSERVICEFILE, or PGHOST/PGDATABASE plus approved pgpass settings.
bash scripts/db/create-staging-logical-backup.sh \
  --confirm-staging-backup \
  --output-dir "$RECOVERY_EVIDENCE_DIR/backup"

# Capture the real recovery start before the approved isolated Neon restore.
node --conditions=react-server --import tsx scripts/staging-recovery-rehearsal.ts \
  --phase start \
  --environment staging \
  --target-label isolated-staging \
  --target-app-url "$RECOVERY_APP_URL" \
  --last-known-good-at "$RECOVERY_LAST_KNOWN_GOOD_AT" \
  --state-file "$RECOVERY_EVIDENCE_DIR/start.json" \
  --evidence-file "$RECOVERY_EVIDENCE_DIR/evidence.json" \
  --confirm-recovery-rehearsal
```

Immediately after the `start` command, the approved provider operator creates
or restores the temporary Neon branch at the selected recovery point and
deploys the isolated application target. Record the provider's exact
recovered-through timestamp; do not run application writes against the target.

Then run the completion phase. It validates the restored schema and counts in
a read-only transaction, checks application health/readiness plus Tenant A
access and Tenant B denial, runs the existing R2 retained-copy/delete/restore
drill, writes redacted JSON evidence, and exits non-zero on any failed phase.

```sh
: "${RECOVERY_DATABASE_URL:?Inject the restored staging database target before execution}"
: "${RECOVERY_SESSION_COOKIE:?Inject the read-only staging session before execution}"
: "${RECOVERY_TENANT_A_ID:?Set Tenant A ID before execution}"
: "${RECOVERY_STATION_A_ID:?Set Tenant A station ID before execution}"
: "${RECOVERY_TENANT_B_ID:?Set Tenant B ID before execution}"
: "${RECOVERY_STATION_B_ID:?Set Tenant B station ID before execution}"
: "${RECOVERY_RECOVERED_THROUGH_AT:?Set the provider recovery-through timestamp before execution}"
# If Deployment Protection is enabled, VERCEL_AUTOMATION_BYPASS_SECRET must
# already be securely exported; it is never supplied as a command argument.

node --conditions=react-server --import tsx scripts/staging-recovery-rehearsal.ts \
  --phase complete \
  --environment staging \
  --target-label isolated-staging \
  --target-app-url "$RECOVERY_APP_URL" \
  --recovered-through-at "$RECOVERY_RECOVERED_THROUGH_AT" \
  --state-file "$RECOVERY_EVIDENCE_DIR/start.json" \
  --evidence-file "$RECOVERY_EVIDENCE_DIR/evidence.json" \
  --confirm-recovery-rehearsal
```

The evidence file is safe to retain as an operational record: it contains the
run ID, redacted target origin, timestamps, pass/fail checks, row counts,
checksum, backup ID, RPO bound, and RTO. It contains no URLs with credentials,
session cookies, database connection strings, object keys, response bodies, or
secrets. Evidence files are created with no-overwrite semantics.

## Measurement and interpretation

- `startedAt` is captured before the provider restore. `endedAt` is captured
  after database, application, and object-storage validation. `RTO` is
  `endedAt - startedAt`, in seconds, and therefore includes operator/provider
  restore time plus validation time.
- `lastKnownGoodAt` is the timestamp of the latest known-good synthetic test
  data or approved staging checkpoint captured before the restore.
  `recoveredThroughAt` is the provider's actual recovery point. The evidence
  records an RPO upper bound of
  `max(0, lastKnownGoodAt - recoveredThroughAt)`, rather than merely repeating
  the 15-minute planning target. The target is shown only as a comparison.
- `rto.measuredSeconds`, `rto.targetSeconds`, and `rto.withinTarget` preserve
  the measured RTO and its four-hour comparison. Overall `pass` is false when
  either `rpo.withinTarget` or `rto.withinTarget` is false, even when database,
  application, and object-storage validation succeed.
- Tenant isolation is proven only when the authenticated read-only check can
  read Tenant A and receives the expected denial/not-found result for Tenant B.
  It does not authorize tenant repair or claim that a tenant-scoped extract
  workflow exists; [`tenant-recovery.md`](tenant-recovery.md) remains open for
  repair execution.

## Failure, abort, rollback, and cleanup

The completion phase runs database validation first, then application
validation, then the R2 drill. A failure stops later phases and writes a
failed, redacted evidence record. Do not bypass a failed safety check or retry
with a production-looking target.

If the R2 phase fails after creating an object, do not reuse its key or delete
retained recovery objects. Record the safe failure code and inspect the
retained object/manifest through the approved R2 procedure. The synthetic
primary is deleted only after successful restore verification; retained
recovery artifacts remain under provider lock and lifecycle policy.

After the rehearsal, the provider owner must quarantine or destroy the
temporary Neon branch, revoke temporary credentials, remove the isolated
deployment, and retain the dump manifest/checksum and redacted evidence under
the approved retention policy. Never delete retained recovery evidence to make
the drill appear clean.
