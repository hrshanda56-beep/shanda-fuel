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
into a ticket, shell history, or command output. Example shape:

```sh
pg_dump --format=custom --file=/secure/recovery/shanda-fuel-UTC.dump "$DATABASE_DIRECT_URL"
pg_restore --list /secure/recovery/shanda-fuel-UTC.dump >/secure/recovery/shanda-fuel-UTC.manifest
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
   environment are available through their separate recovery procedures.
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
| Drill date/operator/approver |  |
| Source backup/PITR timestamp |  |
| Restored timestamp and target |  |
| RPO achieved |  |
| RTO achieved |  |
| Application/readiness/RLS checks |  |
| Lineage and audit checks |  |
| Object-storage/checkpoint checks |  |
| Exceptions and follow-ups |  |

The current RC has this procedure, but no repository evidence of a provider-
executed restore drill. That execution remains a staging/operations gate.
