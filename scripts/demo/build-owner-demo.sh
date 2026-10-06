#!/usr/bin/env bash
set -euo pipefail

if [[ "${APP_ENV:-}" != 'demo' ]]; then
  printf '%s\n' 'Refusing owner-demo build unless APP_ENV=demo.' >&2
  exit 2
fi

exec pnpm build
