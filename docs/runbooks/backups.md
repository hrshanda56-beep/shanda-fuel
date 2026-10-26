# Scheduled database backups and restore drill

Complements [`backup-restore.md`](backup-restore.md) (recovery targets, PITR,
staging evidence). This runbook adds a generic, schedulable logical backup and a
repeatable restore drill. Nothing here is run against production by the
repository tooling; a named operator runs it with credentials from the secret
manager.

## Layers (defence in depth)

1. **Neon point-in-time recovery** (primary control, owner-managed). Record the
   retention window and oldest recoverable timestamp.
2. **Daily logical backup** with `scripts/ops/backup-db.sh` (this runbook):
   protects against provider-level loss and lets us restore outside Neon.
3. **Private object storage (R2) recovery** is separate; see
   [`r2-object-recovery.md`](r2-object-recovery.md).

## The backup script

`scripts/ops/backup-db.sh --env local|staging|production --output-dir DIR`

- Connection from libpq variables (`PGHOST`, `PGUSER`, `PGPASSWORD` or
  `PGPASSFILE`/`PGSERVICE`, `PGDATABASE`, `PGSSLMODE`) or from a connection URL
  piped on stdin with `--url-stdin`. URLs are never accepted as arguments, and
  `DATABASE_URL` / `DATABASE_DIRECT_URL` in the environment are rejected, so
  credentials never appear in argv, logs or output (pg_dump stderr is discarded).
- Use the **direct** (non-pooled) Neon connection for `pg_dump`.
- `production` needs `APP_ENV=production` and `--confirm-production-backup`;
  `staging` needs `APP_ENV=staging`. `local` only accepts loopback hosts and the
  other environments refuse loopback hosts.
- The client major version must be >= the server major (`PG_BIN_DIR` selects the
  client directory; production is currently PostgreSQL 18, do not use 16).
- Output per run: `backup.dump` (custom format, `--no-owner --no-privileges`),
  `backup.manifest` (`pg_restore --list`), `backup.metadata.json` (UTC time,
  server/client major, table-data entry count, SHA-256, size). Directory is mode
  700, files 600. A run that produces an unreadable archive or no table data
  exits non-zero and removes its artifact directory.
- Retention (`--retain-days`, default 14) removes only sibling directories named
  `shanda-fuel-<env>-*` older than N days.

Manual example (operator; credentials supplied by hidden prompt, never typed in
the command):

```sh
read -rs -p 'Direct DB URL: ' U; echo
APP_ENV=production PG_BIN_DIR=/path/to/pg18/bin \
  bash scripts/ops/backup-db.sh --env production --confirm-production-backup \
  --output-dir "$BACKUP_DIR" --url-stdin <<<"$U"
unset U
```

## Nightly scheduling example

The repository does not install or activate a scheduler. The following
systemd example is an operator-owned, disabled-by-default template. It keeps
the database credential in a root-readable libpq passfile or secret-manager
mount; the credential is never placed in the unit, timer, command arguments,
or repository. Replace the paths and environment values only in the approved
backup host.

`/etc/systemd/system/shanda-fuel-nightly-backup.service`:

```ini
[Unit]
Description=Shanda Fuel nightly logical backup

[Service]
Type=oneshot
User=shanda-backup
Group=shanda-backup
Environment=APP_ENV=production
Environment=PGHOST=approved-direct-db-host
Environment=PGPORT=5432
Environment=PGUSER=approved-backup-role
Environment=PGDATABASE=shanda_fuel
Environment=PGSSLMODE=verify-full
Environment=PGPASSFILE=/run/shanda-fuel/pgpass
Environment=PG_BIN_DIR=/opt/postgresql/18/bin
ExecStart=/opt/shanda-fuel/scripts/ops/backup-db.sh --env production --confirm-production-backup --output-dir /var/lib/shanda-fuel/backups --retain-days 30
```

`/etc/systemd/system/shanda-fuel-nightly-backup.timer`:

```ini
[Unit]
Description=Run the Shanda Fuel logical backup nightly

[Timer]
OnCalendar=*-*-* 01:17:00 UTC
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
```

An operator must review the unit, install it on the approved backup host,
restrict the passfile to the service account, enable the timer, and verify one
successful artifact before calling scheduling operational. This documentation
change does none of those things.

Alternative scheduling remains possible, but it must preserve the same
properties: a dedicated least-privilege backup role, encrypted separate
storage, retention, failure alerting, and metadata-only evidence.

### Existing owner decision still required

- **Option A (recommended): scheduled GitHub Actions workflow** on a protected
  `production-backup` environment holding a read-only backup role URL. It runs
  the script daily (`cron: '17 1 * * *'`, UTC), encrypts the artifact with
  `age` to an offline recovery key, uploads it to a **separate** R2 bucket with
  Bucket Lock (not the runtime bucket), and fails loudly (and pages) on error.
  Requirements: a dedicated `pg_dump`-only database role, an R2 write-only
  token, the `age` public key, and a heartbeat monitor (for example Better
  Stack) pinged on success so a missing run alerts.
- **Option B: operator host cron** with the same script and an encrypted
  `PGPASSFILE`. Simpler, but depends on one machine staying alive.

Either way: cadence daily minimum during pilot, retention 14 to 30 days online
plus monthly copies, alert on a run that is missing for 26 hours, and an
approved backup role created by the database owner (not by this repository).

## Restore drill procedure

Run before pilot, after major database changes, and at least quarterly.

1. Choose an **isolated, disposable** target (a scratch Neon branch/project or
   a local PostgreSQL of the same major). Never restore over production.
2. Fetch the latest artifact and decrypt it into a 700 directory.
3. Bootstrap roles on the target the same way as the environment
   (`scripts/db/bootstrap-test.sh` for local/CI; provider roles on Neon) so
   policies and grants that reference application roles restore without error.
4. Run:

   ```sh
   PGHOST=... PGUSER=... PGPASSWORD=... PG_BIN_DIR=... \
   bash scripts/ops/restore-drill.sh --artifact-dir "$ARTIFACT" \
     --target-db shanda_fuel_restore_drill [--drop-after]
   ```

   It verifies the SHA-256, recreates the target (name must contain `restore`
   or `drill`), restores with `--exit-on-error`, then prints migration count and
   per-table row counts and the elapsed time.
5. Compare the row counts and latest migration with the source at the backup
   timestamp, then follow the application checks in `backup-restore.md`
   (readiness, RLS/role topology, representative reports).
6. Record: backup timestamp, artifact SHA-256, restore duration (measured RTO
   input), counts compared, who ran it, who approved. Do not record URLs or
   secrets. Destroy the target and any decrypted copy.

## Local verification performed (2026-10-23)

Against a throwaway local database only (PostgreSQL 18, client 18): backup via
`PG*` variables and via `--url-stdin` (a password canary never appeared in
output); production run without the confirm flag refused; `DATABASE_URL` in the
environment refused; URL argument refused; staging against a loopback host
refused; retention removed an old matching directory and left a non-matching one;
restore drill restored and reported counts; a tampered archive failed the
checksum; a target not named `*restore*`/`*drill*` was refused. Production was
not contacted. The drill against a real Neon branch has not been performed.
