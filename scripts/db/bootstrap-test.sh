#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required for database bootstrap}"

psql "${DATABASE_DIRECT_URL}" --set ON_ERROR_STOP=1 --file ops/db/bootstrap.sql
psql "${DATABASE_DIRECT_URL}" --set ON_ERROR_STOP=1 \
  --file scripts/db/bootstrap-first-user-provisioner.sql
