#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_DIRECT_URL:?DATABASE_DIRECT_URL is required for first-user role proof}"

# Reuse the reviewed migration-time proof. It checks the exact role
# attributes, memberships, ownership, database/schema/table privileges, and
# the fixed function EXECUTE allowlist.
psql "${DATABASE_DIRECT_URL}" --set ON_ERROR_STOP=1 --command \
  'select platform.first_user_provisioning_assert_runtime_role();'

echo 'First-user provisioner role proof passed.'
