#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the disposable loopback demo database}"
: "${BETTER_AUTH_SECRET:?Set a local-only Better Auth secret of at least 32 characters}"
: "${AUDIT_SIGNING_KEY_ID:?Set a local-only audit key id}"
: "${AUDIT_SIGNING_KEY:?Set a local-only audit signing key}"

if [[ "${APP_ENV:-local}" != "local" && "${APP_ENV:-local}" != "test" ]]; then
  printf '%s\n' 'Refusing owner-demo seed outside APP_ENV=local or APP_ENV=test.' >&2
  exit 2
fi

demo_host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname.toLowerCase())' "$DATABASE_URL")"
case "$demo_host" in
  localhost|127.0.0.1|::1) ;;
  *) printf '%s\n' 'Refusing owner-demo seed for a non-loopback database host.' >&2; exit 2 ;;
esac

if [[ ! -t 0 ]]; then
  printf '%s\n' 'Owner-demo password must be entered from an interactive terminal.' >&2
  exit 2
fi

read -r -s -p 'Synthetic demo password (12+ characters): ' DEMO_PASSWORD
printf '\n'
trap 'unset DEMO_PASSWORD' EXIT HUP INT TERM

APP_ENV="${APP_ENV:-local}" \
DATABASE_URL="$DATABASE_URL" \
BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
AUDIT_SIGNING_KEY_ID="$AUDIT_SIGNING_KEY_ID" \
AUDIT_SIGNING_KEY="$AUDIT_SIGNING_KEY" \
DEMO_PASSWORD="$DEMO_PASSWORD" \
node --conditions=react-server --import tsx scripts/demo/seed-owner-demo.ts
