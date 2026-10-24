#!/usr/bin/env bash
# Restore-drill helper: verify a backup artifact and restore it into a
# DISPOSABLE database, then print evidence for the drill record.
#
# Usage: scripts/ops/restore-drill.sh --artifact-dir DIR --target-db NAME [--drop-after]
#
# Connection: libpq PG* variables only (never a URL argument). PGDATABASE is
# ignored for the target; --target-db names the database that is (re)created.
# The target name must contain "restore" or "drill" so a drill can never
# overwrite a real database. Never point this at production.
set -euo pipefail
umask 077

die() { echo "restore-drill: $*" >&2; exit 1; }
artifact=""; target=""; drop_after=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir) artifact="${2:-}"; shift 2 ;;
    --target-db) target="${2:-}"; shift 2 ;;
    --drop-after) drop_after=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -d "$artifact" && -n "$target" ]] || die "usage: --artifact-dir DIR --target-db NAME [--drop-after]"
[[ "$target" =~ ^[a-z0-9_]*(restore|drill)[a-z0-9_]*$ ]] || die "target database name must match [a-z0-9_]*(restore|drill)[a-z0-9_]*"
if [[ -n "${DATABASE_URL:-}" || -n "${DATABASE_DIRECT_URL:-}" ]]; then die "DATABASE_URL/DATABASE_DIRECT_URL are not accepted; use PG* variables"; fi
[[ -n "${PGSERVICE:-}" || -n "${PGHOST:-}" ]] || die "set PGSERVICE or PGHOST"
case "${PGHOST:-}" in 127.0.0.1 | localhost | ::1 | /*) ;; *) [[ "${RESTORE_DRILL_ALLOW_REMOTE:-}" == "1" ]] || die "remote host refused; set RESTORE_DRILL_ALLOW_REMOTE=1 for an isolated provider restore target" ;; esac

bin() { if [[ -n "${PG_BIN_DIR:-}" ]]; then echo "$PG_BIN_DIR/$1"; else echo "$1"; fi; }
PSQL="$(bin psql)"; PG_RESTORE="$(bin pg_restore)"
dump="$artifact/backup.dump"; meta="$artifact/backup.metadata.json"
[[ -f "$dump" && -f "$meta" ]] || die "artifact is missing backup.dump or backup.metadata.json"

expected="$(sed -n 's/.*"sha256": "\([0-9a-f]\{64\}\)".*/\1/p' "$meta")"
if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$dump" | awk '{print $1}')"; else actual="$(sha256sum "$dump" | awk '{print $1}')"; fi
[[ -n "$expected" && "$expected" == "$actual" ]] || die "checksum mismatch: archive is corrupt or altered"
echo "restore-drill: checksum verified"

start="$(date +%s)"
export PGDATABASE=postgres
"$PSQL" --no-psqlrc -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$target\"" -c "CREATE DATABASE \"$target\""
export PGDATABASE="$target"
# Errors about missing application roles (policies/grants) are reported, not
# hidden: bootstrap the environment roles first when drilling RLS (see runbook).
if ! "$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname="$target" "$dump" 2>"$artifact/restore.err"; then
  echo "restore-drill: pg_restore reported errors (first lines):" >&2
  head -n 5 "$artifact/restore.err" >&2
  die "restore failed; see $artifact/restore.err"
fi
rm -f "$artifact/restore.err"
elapsed=$(( $(date +%s) - start ))

echo "restore-drill: restored into $target in ${elapsed}s"
"$PSQL" --no-psqlrc -q -t -A -c "SELECT 'user tables: ' || count(*) FROM pg_stat_user_tables" \
  -c "SELECT 'migrations applied: ' || count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo "restore-drill: drizzle migration table not found"
echo "restore-drill: per-table row counts (record these in the drill evidence):"
"$PSQL" --no-psqlrc -q -t -A -c "SELECT format('%s %s', table_schema||'.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text) FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1"

if [[ "$drop_after" -eq 1 ]]; then
  export PGDATABASE=postgres
  "$PSQL" --no-psqlrc -q -c "DROP DATABASE \"$target\""
  echo "restore-drill: dropped $target"
fi
