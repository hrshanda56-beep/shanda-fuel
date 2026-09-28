# R2 deleted-object recovery runbook

## Status and scope

The repository contains a recovery-aware private-storage adapter and a dedicated
staging drill. The provider prerequisites were configured and the staging drill
was witnessed successfully on 2026-09-28, closing the R2 deleted-object recovery
sub-gate for the exercised Lane 4 staging scope.

The ordinary [`staging platform smoke`](../platform/STAGING_SMOKE.md) remains a
put/read/delete check only. It does not exercise or evidence recovery.

## Required provider configuration

Before enabling recovery-aware private storage in an environment, the provider
owner must configure all of the following without placing credentials in the
repository:

1. A separate private recovery bucket, distinct from `R2_BUCKET`, and the
   `R2_RECOVERY_BUCKET` name plus separate recovery credentials in the approved
   secret manager.
2. Bucket Lock rules covering `recovery/v1/objects/` and
   `recovery/v1/manifests/`. The lock must prevent overwrite and deletion for
   the approved retention period.
3. An owner/accountant-approved retention and lifecycle policy. No default
   retention duration is defined in application code. Staging currently uses
   30 days for both Bucket Lock and `recovery/v1/` lifecycle expiry; production
   retention remains a separate owner/accountant decision.
4. Private, least-privilege access: no public bucket/domain access; separate
   recovery-bucket credentials; no bucket-configuration authority in the
   application runtime; and a named recovery operator for the drill and any
   restore.
5. A verified initial inventory/backfill for every pre-existing primary object
   before allowing its deletion through the recovery-aware adapter.

The runtime requires these uncommitted settings together:

```text
R2_ACCOUNT_ID
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_RECOVERY_BUCKET
R2_RECOVERY_ACCESS_KEY_ID
R2_RECOVERY_SECRET_ACCESS_KEY
```

Recovery is intentionally unavailable if the recovery destination is missing,
incomplete, or the same bucket as the primary destination.

## Recovery behavior

For each primary write, the adapter first creates unique immutable recovery
bytes and a manifest under `recovery/v1/`. The manifest records source bucket
and key, content type, byte length, backup ID, UTC timestamp, format version,
and a SHA-256 digest of the actual bytes. Only after both recovery writes
succeed does it write the primary object.

A primary delete first reads the current primary bytes, lists retained manifests
for that source key, and verifies a matching retained object digest, size, and
content type. It refuses deletion when no verified retained copy exists.

Restore reads and verifies the retained object, refuses an existing primary
destination, uses a no-overwrite primary write, and reads the restored object
back for SHA-256 verification. Recovery copies and manifests are never deleted
by the application.

## Staging recovery drill

Prerequisites: the provider controls above are active in staging, the recovery
credentials are loaded from the approved secret manager without echoing them,
and the operator has approval to create one synthetic staging object.

Run only from a trusted operator shell:

```sh
APP_ENV=staging pnpm drill:staging-r2-recovery --confirm-recovery-drill
```

The command uses a random `private/staging/recovery-drill/` key and performs:

1. write primary only after immutable recovery object and manifest creation;
2. read primary;
3. guarded primary deletion and absence verification;
4. no-overwrite restore from the retained backup;
5. read-back length and checksum verification; and
6. guarded deletion of the restored synthetic primary object.

It prints only the backup ID and SHA-256 evidence. It does not print keys or
credentials. The retained synthetic backup is deliberately left for the
approved retention/lifecycle policy; do not manually delete it to make the
drill appear clean.

If the command fails after creating its primary object, do not retry against
the same key or delete recovery objects. Record the typed error, backup ID if
available, UTC time, and operator; inspect the private recovery bucket through
the approved recovery procedure.

## Lane 4 evidence and limits

Attach all of the following before changing R2 deleted-object recovery to
complete:

- non-secret provider evidence for distinct bucket, Bucket Lock, lifecycle,
  retention approval, and access isolation;
- the reviewed adapter tests, including backup-write failure, missing retained
  copy, checksum mismatch, destination-already-present, and successful restore;
- a witnessed staging drill record containing operator/approver, UTC timing,
  environment, source and recovery bucket names, backup ID, digest, outcome,
  and primary cleanup result; and
- confirmation that the retained artifact remains readable while locked.

## Witnessed staging evidence — 2026-09-28

| Field | Result |
| --- | --- |
| Environment | Staging |
| Canonical source commit | `fc10d0112b1e504a58f241326167edec934571cc` |
| Staging deployment | `dpl_4p5rQvNKxP7hzS8BXtNjpbj1AxpP`; Ready; `/api/health` and `/api/readiness` HTTP 200 before the drill |
| Primary bucket | `shanda-fuel-staging-private` |
| Recovery bucket | `shanda-fuel-staging-recovery`; Standard; public access disabled |
| Bucket Lock | `recovery/v1/objects/` and `recovery/v1/manifests/`, 30 days, enabled |
| Lifecycle | `recovery/v1/`, delete after 30 days, enabled; provider default incomplete-multipart abort remains 7 days |
| Drill result | **PASS**, exit code 0 |
| Backup ID | `a8e1cd42-cd34-4f73-a837-1710648d3c7e` |
| SHA-256 | `146f8cd7a6a4435906f62232c7ee4586a0889181bd6424fe49d45f2f3264a2d7` |
| Retained evidence | Object present under `recovery/v1/objects/` (59 B, `text/plain`) and manifest present under `recovery/v1/manifests/` (685 B, `application/json`) |
| Provider timestamp | Both retained artifacts recorded at 2026-09-28 16:30:53 Africa/Harare (14:30:53 UTC) |
| Primary cleanup | Synthetic primary object deleted after restore verification |
| Credential cleanup | Temporary primary-drill credential revoked; recovery application credential remains active |
| Operator/approver | Authenticated staging operator; no separate approver is recorded in this evidence |
| RPO/RTO | **NOT DEMONSTRATED** by this drill |

The retained object was read and checksum-verified by the guarded deletion and
restore flow while the lock controls were active, and the retained object and
manifest remained present afterward in the provider UI.

This drill is deleted-object recovery evidence, not an RPO or RTO measurement.
RPO ≤15 minutes and RTO ≤4 hours remain unproven until separately measured and
recorded against approved targets.
