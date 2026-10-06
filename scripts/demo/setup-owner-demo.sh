#!/usr/bin/env bash
set -euo pipefail

: "${APP_ENV:?Set APP_ENV=demo for the hosted owner demo}"
: "${DATABASE_URL:?Set DATABASE_URL through the approved hidden environment}"
: "${BETTER_AUTH_SECRET:?Set the demo Better Auth secret through the approved secret store}"
: "${AUDIT_SIGNING_KEY_ID:?Set the demo audit key id through the approved secret store}"
: "${AUDIT_SIGNING_KEY:?Set the demo audit signing key through the approved secret store}"

if [[ "$APP_ENV" != 'demo' ]]; then
  printf '%s\n' 'Refusing hosted owner-demo setup unless APP_ENV=demo.' >&2
  exit 2
fi

database_name="$(DATABASE_URL="$DATABASE_URL" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "")))')"
if [[ "$database_name" != 'shanda_fuel_demo' ]]; then
  printf '%s\n' 'Refusing hosted owner-demo setup for an unexpected database name.' >&2
  exit 2
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
(
  cd "$repo_root"
  APP_ENV="$APP_ENV" DATABASE_URL="$DATABASE_URL" \
    node --conditions=react-server --import tsx scripts/demo/bootstrap-owner-demo.ts
  DATABASE_DIRECT_URL="$DATABASE_URL" pnpm exec drizzle-kit migrate --config drizzle.config.ts
)
APP_ENV="$APP_ENV" DATABASE_URL="$DATABASE_URL" BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  AUDIT_SIGNING_KEY_ID="$AUDIT_SIGNING_KEY_ID" AUDIT_SIGNING_KEY="$AUDIT_SIGNING_KEY" \
  DEMO_RESET="${DEMO_RESET:-0}" bash scripts/demo/seed-owner-demo.sh
