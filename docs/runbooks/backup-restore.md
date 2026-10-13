# Backup and restore runbook

## Scope and targets

This runbook covers PostgreSQL recovery and the evidence required before pilot
or production approval. The architecture targets are planning goals, not an
SLA: RPO ≤ 15 minutes and RTO ≤ 4 hours. Tenant-scoped logical corruption must
be repaired through an isolated restore/extract/repair path, not a whole-
production rollback.

The database, private object storage, audit checkpoints, and backups are
separate operational boundaries. This runbook does not authorize direct edits
to posted/locked records, RLS policies, migrations, or accounting authorities.

## Required ownership and access

- A named deployment/database owner with provider console access and a
  break-glass record.
- Separate staging and production projects, credentials, and storage paths.
- `migration_owner`/provider-admin access for restore infrastructure only;
  application runtime credentials are never used for role creation, restore,
  or ownership changes.
- Encrypted backup storage outside the normal runtime blast radius, with access
  logging and retention approved by the owner/accountant.

## Backup schedule and evidence

1. Keep provider point-in-time recovery enabled for the production database;
   record its retention and the oldest recoverable timestamp.
2. Take an independent logical backup at the approved cadence, at minimum
   daily while the system is in pilot. Use an encrypted destination that is not
   the application runtime bucket.
3. Record backup timestamp in UTC, environment, source deployment, database
   identifier, storage object/version, checksum, size, retention expiry, and
   operator. Do not put a database URL or secret in the evidence.
4. Verify the backup can be listed/read by the recovery owner and that its
   archive is structurally inspectable. A successful upload alone is not a
   restore test.

An operator may use the provider's managed backup export or an approved
`pg_dump` custom-format export from the direct database connection. Keep the
connection string in the secret manager or process environment; never paste it
into a ticket, shell history, or command output. The `pg_dump` and `pg_restore`
client major must be compatible with the staging database server major. During
the 2026-09-30 staging rehearsal, the server reported PostgreSQL 18.6 and the
successful Docker client was the official `postgres:18` image. This records the
verified rehearsal environment, not a permanent infrastructure assumption:
reconfirm the server major before future backups and use a matching client.
`postgres:16` must not be used for the current staging server.

The canonical staging procedure intentionally rejects `DATABASE_DIRECT_URL`.
Run the existing backup script from the approved `postgres:18` client
environment with the standard libpq variables and any approved service/pass
files already inherited; no database credential is placed in a `pg_dump`
argument:

```sh
APP_ENV=staging bash scripts/db/create-staging-logical-backup.sh \
  --confirm-staging-backup \
  --output-dir "$RECOVERY_EVIDENCE_DIR/backup"
```

The exact provider export path, encryption key, retention, and bucket are
environment-specific and must be filled in by the deployment owner.

## Isolated restore drill

Run before pilot/major database changes and at least quarterly thereafter:

1. Open an isolated restore target in staging or a provider recovery project;
   never restore over production for a drill.
2. Restore to a timestamp that exercises the stated RPO. Keep the restored
   database inaccessible to normal users until validation is complete.
3. Apply only the documented environment bootstrap and migration ownership
   steps. Do not invent down-migrations or edit canonical migration history.
4. Start the application against the isolated target using staging secrets and
   verify `/api/health`, `/api/readiness`, role topology, tenant context, RLS,
   and representative read-only reports.
5. Verify record counts/checksums and representative lineage across A3/A4/A5,
   A6/A9, REV1/A12, audit, idempotency, and security-event evidence. Use
   tenant-scoped queries through the application or approved diagnostics role.
6. Confirm that private objects/audit checkpoints needed by the restored
   environment are available through their separate recovery procedures. For
   R2 deleted objects, use [`r2-object-recovery.md`](r2-object-recovery.md).
7. Measure time from incident declaration to usable isolated service and record
   the recovered timestamp. Compare with RPO/RTO planning goals.
8. Destroy or quarantine the isolated target according to the provider's
   approved retention process and record who approved that action.

## Production recovery decision

- For an application-only defect with schema compatibility, use the previous
  immutable application deployment as described in [`deployment.md`](deployment.md).
- For database availability, provider failure, or broad corruption, page the
  incident owner and use provider PITR or the approved logical backup. Do not
  reverse a canonical migration or run ad hoc SQL against financial records.
- For tenant-scoped logical corruption, restore/extract the affected tenant in
  isolation, have the responsible domain/accounting owner review the repair,
  and apply named correction/reversal commands through the application where
  supported. See [`tenant-recovery.md`](tenant-recovery.md).
- Preserve the original evidence and audit trail. A restore is a recovery
  event, not permission to rewrite history.

## Drill record

| Field | Result |
| --- | --- |
| Drill date/operator/approver | 2026-09-28; operator/approver not recorded in this documentation update. |
| Source backup/PITR timestamp | Neon PITR isolated restore; exact source timestamp is not recorded here. |
| Restored timestamp and target | Temporary Neon recovery branch `lane4-restore-drill-20260928`; auto-expiring after one day. |
| PostgreSQL 18 logical backup and restore | **NOT EVIDENCED FOR MILESTONE A** — this record documents a PITR/branch restore, not a PostgreSQL 18 custom-format `pg_dump` archived with checksum and restored with `pg_restore`. Use the owner procedure in [`milestone-a-release.md`](milestone-a-release.md#25-postgresql-18-logical-backup-and-isolated-restore-gate). |
| RPO achieved | **NOT DEMONSTRATED BY THIS DRILL**; RPO ≤15 minutes is not claimed. |
| RTO achieved | **NOT DEMONSTRATED**; full RTO ≤4 hours is not claimed. |
| Application/readiness/RLS checks | Isolated temporary Vercel Preview deployment `dpl_Ejf2DLRpiuQUnqg87FXwnvnhyLqY` of source commit `7ba5e683f751f92fbb39755f7d322bfdcc10a8e3` **VERIFIED** app-to-restored-DB readiness. `/api/health` returned HTTP 200 with application `ok`; `/api/readiness` returned HTTP 200 with database `ok`. |
| Lineage and audit checks | **COMPLETE** through independent Neon SQL Editor validation of migrations, hierarchy, permissions, lineage, audit evidence, RLS/policies, and checksums. |
| Object-storage/checkpoint checks | **COMPLETE / PASSED FOR STAGING R2 DELETED-OBJECT RECOVERY** — separate private recovery bucket `shanda-fuel-staging-recovery`; 30-day Bucket Lock on `recovery/v1/objects/` and `recovery/v1/manifests/`; 30-day `recovery/v1/` lifecycle expiry; witnessed drill exit code 0; backup `a8e1cd42-cd34-4f73-a837-1710648d3c7e`; SHA-256 `146f8cd7a6a4435906f62232c7ee4586a0889181bd6424fe49d45f2f3264a2d7`; retained object and manifest present afterward; synthetic primary deleted; temporary primary-drill credential revoked. |
| Exceptions and follow-ups | The earlier local readiness result was not classified as a restored-database failure. The isolated Vercel Preview verification invoked no auth, POST, financial, R2, email, cron, migration, smoke, or other write-capable route. The temporary Vercel project and deployments were deleted afterward. Do not claim RPO ≤15 minutes or RTO ≤4 hours from this drill. |

Lane 4 provides evidence of the isolated database PITR restore, independent
restored-database validation, isolated application connectivity to the
recovered branch, and provider-configured staging R2 deleted-object recovery.
It is not evidence of the separate PostgreSQL 18 logical-backup/restore gate.
The exercised database/application/R2 recovery scope is complete. RPO ≤15
minutes and RTO ≤4 hours remain unproven, and tenant-scoped recovery remains a
separate exercise.
