# Restore entry point

This file is the compatibility entry point for operators and automation that
look for `RESTORE.md`. It is a pointer, not an authorization to restore any
environment.

The complete procedure is [`docs/runbooks/backup-restore.md`](docs/runbooks/backup-restore.md).
The schedulable logical-backup and disposable restore-drill commands are
documented in [`docs/runbooks/backups.md`](docs/runbooks/backups.md).

For a local or approved isolated drill, use the repository helper after
reviewing the runbook:

```sh
bash scripts/ops/restore-drill.sh \
  --artifact-dir "$ARTIFACT" \
  --target-db shanda_fuel_restore_drill \
  --drop-after
```

The helper refuses database URLs in arguments and refuses target names that do
not contain `restore` or `drill`. Do not point it at production, and do not run
this entry point as part of a deploy or migration automatically.
