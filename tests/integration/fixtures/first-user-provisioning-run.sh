#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
pg_host="${PGHOST:-127.0.0.1}"
pg_port="${PGPORT:-55432}"
pg_user="${PGUSER:-$(id -un)}"
test_db='shanda_fuel_first_user_test'

if [[ "$pg_host" != '127.0.0.1' || "$pg_port" != '55432' ]]; then
  printf '%s\n' 'Refusing a non-local PostgreSQL endpoint; this fixture is local-only.' >&2
  exit 1
fi

export APP_ENV=local
export FIRST_USER_PROVISIONING_TEST_DATABASE=true
export DATABASE_URL="postgresql://first_user_provisioner@${pg_host}:${pg_port}/${test_db}"
export FIRST_USER_PROVISIONING_TEST_ADMIN_DATABASE_URL="postgresql://${pg_user}@${pg_host}:${pg_port}/${test_db}"
export FIRST_USER_PROVISIONING_TEST_APP_RUNTIME_DATABASE_URL="postgresql://app_runtime@${pg_host}:${pg_port}/${test_db}"
export FIRST_USER_PROVISIONING_TEST_UNRELATED_DATABASE_URL="postgresql://first_user_unrelated@${pg_host}:${pg_port}/${test_db}"
export FIRST_USER_PROVISIONING_TEST_TENANT_ID='11111111-1111-4111-8111-111111111111'
export FIRST_USER_PROVISIONING_TEST_LEGAL_ENTITY_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export FIRST_USER_PROVISIONING_TEST_STATION_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
export FIRST_USER_PROVISIONING_TEST_CROSS_TENANT_ID='22222222-2222-4222-8222-222222222222'
export FIRST_USER_PROVISIONING_TEST_CROSS_TENANT_LEGAL_ENTITY_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export FIRST_USER_PROVISIONING_TEST_CROSS_TENANT_STATION_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
export FIRST_USER_PROVISIONING_TEST_CROSS_ENTITY_STATION_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
export FIRST_USER_PROVISIONING_TEST_ROLLBACK_TENANT_ID='33333333-3333-4333-8333-333333333333'
export FIRST_USER_PROVISIONING_TEST_ROLLBACK_LEGAL_ENTITY_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
export FIRST_USER_PROVISIONING_TEST_ROLLBACK_STATION_ID='cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
export FIRST_OWNER_PROVISIONING_TEST_TENANT_ID='a8852b9f-c490-4a72-a3f3-8662aeb14a8a'
export FIRST_OWNER_PROVISIONING_TEST_LEGAL_ENTITY_ID='cb5789ea-0979-450e-83d1-9834135cbedf'
export FIRST_OWNER_PROVISIONING_TEST_STATION_IDS='d8913b4d-7bb8-48cb-bb46-a741cea1f6c5,c4954604-2bcb-4e59-96e9-12e35449545c,ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f,68ef219f-6baa-442a-8465-6d52e505d1f3'

cd "$repo_root"
exec pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/first-user-provisioning.test.ts \
  tests/integration/first-owner-provisioning.test.ts --reporter verbose
