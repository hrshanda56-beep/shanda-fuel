#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${APP_ENV:-}" != "staging" ]]; then
  echo "Refusing logical backup: APP_ENV=staging is required." >&2
  exit 1
fi
if [[ "${1:-}" != "--confirm-staging-backup" || "${2:-}" != "--output-dir" || -z "${3:-}" ]]; then
  echo "Usage: APP_ENV=staging $0 --confirm-staging-backup --output-dir PATH" >&2
  exit 1
fi
if [[ -n "${DATABASE_DIRECT_URL:-}" ]]; then
  echo "DATABASE_DIRECT_URL is not accepted; configure standard libpq environment or service settings." >&2
  exit 1
fi
if [[ -z "${PGSERVICE:-}" && -z "${PGHOST:-}" ]]; then
  echo "PGSERVICE or PGHOST must be configured through the approved libpq secret mechanism." >&2
  exit 1
fi
if [[ -z "${PGSERVICE:-}" && -z "${PGDATABASE:-}" ]]; then
  echo "PGDATABASE is required when PGSERVICE is not configured." >&2
  exit 1
fi

output_dir="$3"
mkdir -p -- "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_dir="$(mktemp -d "$output_dir/shanda-fuel-staging-$timestamp.XXXXXX")"
backup_file="$artifact_dir/backup.dump"
manifest_file="$artifact_dir/backup.manifest"
metadata_file="$artifact_dir/backup.metadata.json"

for artifact in "$backup_file" "$manifest_file" "$metadata_file"; do
  if [[ -e "$artifact" ]]; then
    echo "Refusing to replace an existing backup artifact." >&2
    exit 1
  fi
done

if ! pg_dump --format=custom --no-owner --no-privileges --file="$backup_file" >/dev/null 2>&1; then
  echo "Staging logical backup failed." >&2
  exit 1
fi
if ! (set -o noclobber; pg_restore --list "$backup_file" >"$manifest_file") 2>/dev/null; then
  echo "Staging logical backup manifest inspection failed." >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "$backup_file" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
else
  echo "A SHA-256 utility (shasum or sha256sum) is required." >&2
  exit 1
fi

size_bytes="$(wc -c <"$backup_file" | tr -d '[:space:]')"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if ! (set -o noclobber; printf '{\n  "schemaVersion": "shanda-fuel.staging-logical-backup.v1",\n  "environment": "staging",\n  "createdAt": "%s",\n  "file": "%s",\n  "manifest": "%s",\n  "sha256": "%s",\n  "sizeBytes": %s\n}\n' \
  "$created_at" "$(basename "$backup_file")" "$(basename "$manifest_file")" "$checksum" "$size_bytes" \
  >"$metadata_file") 2>/dev/null; then
  echo "Staging logical backup metadata already exists or could not be created." >&2
  exit 1
fi

chmod 600 "$backup_file" "$manifest_file" "$metadata_file"
echo "Staging logical backup created in: $(basename "$artifact_dir")"
echo "Manifest and SHA-256 metadata created without database credentials."
