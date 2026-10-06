#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL through the approved local/demo environment}"
: "${BETTER_AUTH_SECRET:?Set a local-only Better Auth secret of at least 32 characters}"
: "${AUDIT_SIGNING_KEY_ID:?Set a local-only audit key id}"
: "${AUDIT_SIGNING_KEY:?Set a local-only audit signing key}"

if [[ "${APP_ENV:-}" != "local" && "${APP_ENV:-}" != "test" && "${APP_ENV:-}" != "demo" ]]; then
  printf '%s\n' 'Refusing owner-demo seed unless APP_ENV is explicitly local, test, or demo.' >&2
  exit 2
fi

if [[ "${APP_ENV}" != 'demo' ]]; then
  demo_host="$(DATABASE_URL="$DATABASE_URL" node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).hostname.toLowerCase())')"
  case "$demo_host" in
    localhost|127.0.0.1|::1) ;;
    *) printf '%s\n' 'Refusing local/test owner-demo seed for a non-loopback database host.' >&2; exit 2 ;;
  esac
fi

if [[ ! -t 0 ]]; then
  printf '%s\n' 'Owner-demo password must be entered from an interactive terminal.' >&2
  exit 2
fi

read -r -s -p 'Synthetic demo password (12+ characters): ' DEMO_PASSWORD
printf '\n'
trap 'unset DEMO_PASSWORD' EXIT HUP INT TERM

APP_ENV="$APP_ENV" \
DATABASE_URL="$DATABASE_URL" \
BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
AUDIT_SIGNING_KEY_ID="$AUDIT_SIGNING_KEY_ID" \
  AUDIT_SIGNING_KEY="$AUDIT_SIGNING_KEY" \
  DEMO_PASSWORD="$DEMO_PASSWORD" \
  DEMO_RESET="${DEMO_RESET:-0}" \
  node --conditions=react-server --import tsx scripts/demo/seed-owner-demo.ts
