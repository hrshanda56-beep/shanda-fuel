#!/usr/bin/env bash
# Scheduled-capable PostgreSQL logical backup (pg_dump custom format).
#
# Connection comes ONLY from standard libpq environment variables / service
# files (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE, PGSERVICE,
# PGPASSFILE) or from a connection URL piped on stdin (--url-stdin). A
# database URL is never accepted as an argument and DATABASE_URL /
# DATABASE_DIRECT_URL in the environment are rejected, so credentials never
# reach process argv, logs or shell history.
#
# Usage:
#   scripts/ops/backup-db.sh --env local|staging|production \
#       --output-dir DIR [--retain-days N] [--url-stdin] \
#       [--confirm-production-backup]
#
# Environment: PG_BIN_DIR (optional) selects the pg_dump/pg_restore/psql client
# directory; the client major version must be >= the server major version.
set -euo pipefail
umask 077

usage() {
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}
die() {
  echo "backup-db: $*" >&2
  exit 1
}

env_name=""
output_dir=""
retain_days=14
url_stdin=0
confirm_prod=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env_name="${2:-}"; shift 2 ;;
    --output-dir) output_dir="${2:-}"; shift 2 ;;
    --retain-days) retain_days="${2:-}"; shift 2 ;;
    --url-stdin) url_stdin=1; shift ;;
    --confirm-production-backup) confirm_prod=1; shift ;;
    -h | --help) usage ;;
    *) die "unknown argument: $1 (database URLs are never accepted as arguments)" ;;
  esac
done

[[ "$env_name" =~ ^(local|staging|production)$ ]] || usage
[[ -n "$output_dir" ]] || usage
[[ "$retain_days" =~ ^[0-9]+$ && "$retain_days" -ge 1 ]] || die "--retain-days must be a positive integer"
if [[ -n "${DATABASE_URL:-}" || -n "${DATABASE_DIRECT_URL:-}" ]]; then
  die "DATABASE_URL/DATABASE_DIRECT_URL are not accepted; use libpq PG* variables or --url-stdin"
fi
if [[ "$env_name" == "production" && "$confirm_prod" -ne 1 ]]; then
  die "production backups require --confirm-production-backup"
fi
if [[ "$env_name" != "local" && "${APP_ENV:-}" != "$env_name" ]]; then
  die "APP_ENV=$env_name is required for a $env_name backup"
fi

bin() { if [[ -n "${PG_BIN_DIR:-}" ]]; then echo "$PG_BIN_DIR/$1"; else echo "$1"; fi; }
PG_DUMP="$(bin pg_dump)"
PG_RESTORE="$(bin pg_restore)"
PSQL="$(bin psql)"

if [[ "$url_stdin" -eq 1 ]]; then
  # Parse the URL with node (already a project prerequisite) and assign the
  # components to PG* variables via bash builtins only; nothing is placed in
  # argv and nothing is echoed.
  read -r url || true
  [[ -n "${url:-}" ]] || die "--url-stdin given but stdin was empty"
  {
    IFS= read -r -d '' PGHOST || true
    IFS= read -r -d '' PGPORT || true
    IFS= read -r -d '' PGUSER || true
    IFS= read -r -d '' PGPASSWORD || true
    IFS= read -r -d '' PGDATABASE || true
    IFS= read -r -d '' PGSSLMODE || true
  } < <(
    printf '%s' "$url" | node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        let u; try { u = new URL(s.trim()); } catch { process.exit(3); }
        if (!/^postgres(ql)?:$/.test(u.protocol)) process.exit(3);
        const f = [u.hostname, u.port, decodeURIComponent(u.username), decodeURIComponent(u.password),
          decodeURIComponent(u.pathname.replace(/^\//, "")), u.searchParams.get("sslmode") || ""];
        process.stdout.write(f.join("\0") + "\0");
      });'
  ) || die "stdin is not a valid postgres:// URL"
  unset url
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
  [[ -n "$PGSSLMODE" ]] && export PGSSLMODE || unset PGSSLMODE
  [[ -n "$PGPORT" ]] || unset PGPORT
fi

if [[ -z "${PGSERVICE:-}" && -z "${PGHOST:-}" ]]; then
  die "no connection configured: set PGSERVICE or PGHOST (or use --url-stdin)"
fi
if [[ -z "${PGSERVICE:-}" && -z "${PGDATABASE:-}" ]]; then
  die "PGDATABASE is required when PGSERVICE is not configured"
fi

# Refuse to take a 'local' backup of anything that is not loopback, and refuse
# the protected development/test database names for non-local envs mix-ups.
host="${PGHOST:-}"
if [[ "$env_name" == "local" && -n "$host" ]]; then
  case "$host" in
    127.0.0.1 | localhost | ::1 | /*) ;;
    *) die "--env local requires a loopback PGHOST" ;;
  esac
fi
if [[ "$env_name" != "local" ]]; then
  case "$host" in
    127.0.0.1 | localhost | ::1) die "--env $env_name refuses a loopback host" ;;
  esac
fi

# pg_dump refuses an older client than the server, but fail with a clear
# message first.
server_num="$("$PSQL" --no-psqlrc --tuples-only --no-align --command 'SHOW server_version_num' 2>/dev/null || true)"
[[ "$server_num" =~ ^[0-9]+$ ]] || die "cannot connect to the database (check PG* configuration)"
server_major=$((server_num / 10000))
client_major="$("$PG_DUMP" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if [[ "$client_major" -lt "$server_major" ]]; then
  die "pg_dump major $client_major is older than server major $server_major; set PG_BIN_DIR to a matching client"
fi

mkdir -p -- "$output_dir"
chmod 700 "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_dir="$(mktemp -d "$output_dir/shanda-fuel-$env_name-$timestamp.XXXXXX")"
backup_file="$artifact_dir/backup.dump"
manifest_file="$artifact_dir/backup.manifest"
metadata_file="$artifact_dir/backup.metadata.json"
cleanup_failed() { rm -rf -- "$artifact_dir"; }
trap cleanup_failed ERR

"$PG_DUMP" --format=custom --no-owner --no-privileges --file="$backup_file" >/dev/null 2>"$artifact_dir/pg_dump.err" ||
  { echo "backup-db: pg_dump failed (details withheld; stderr discarded to avoid leaking connection data)" >&2; false; }
rm -f -- "$artifact_dir/pg_dump.err"
"$PG_RESTORE" --list "$backup_file" >"$manifest_file" 2>/dev/null || { echo "backup-db: archive is not readable by pg_restore" >&2; false; }
data_entries="$(grep -c ' TABLE DATA ' "$manifest_file" || true)"
[[ "$data_entries" -gt 0 ]] || { echo "backup-db: archive contains no table data entries" >&2; false; }

if command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "$backup_file" | awk '{print $1}')"
else
  checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
fi
size_bytes="$(wc -c <"$backup_file" | tr -d '[:space:]')"
printf '{\n  "schemaVersion": "shanda-fuel.logical-backup.v1",\n  "environment": "%s",\n  "createdAt": "%s",\n  "serverMajor": %s,\n  "clientMajor": %s,\n  "file": "backup.dump",\n  "manifest": "backup.manifest",\n  "tableDataEntries": %s,\n  "sha256": "%s",\n  "sizeBytes": %s\n}\n' \
  "$env_name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$server_major" "$client_major" "$data_entries" "$checksum" "$size_bytes" >"$metadata_file"
chmod 600 "$backup_file" "$manifest_file" "$metadata_file"
trap - ERR

# Retention: only remove sibling artifact directories created by this script
# (strict name pattern) that are older than N days. Never touches other files.
find "$output_dir" -mindepth 1 -maxdepth 1 -type d -name "shanda-fuel-$env_name-*" -mtime "+$retain_days" -exec rm -rf -- {} + 2>/dev/null || true

echo "backup-db: created $(basename "$artifact_dir") (env=$env_name, table-data entries=$data_entries, sha256=$checksum)"
