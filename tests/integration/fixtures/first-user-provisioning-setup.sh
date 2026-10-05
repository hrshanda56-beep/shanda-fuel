#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
pg_bin="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
pg_host="${PGHOST:-127.0.0.1}"
pg_port="${PGPORT:-55432}"
pg_user="${PGUSER:-$(id -un)}"
test_db='shanda_fuel_first_user_test'

if [[ "$pg_host" != '127.0.0.1' || "$pg_port" != '55432' ]]; then
  printf '%s\n' 'Refusing a non-local PostgreSQL endpoint; this fixture is local-only.' >&2
  exit 1
fi

for binary in pg_isready psql dropdb createdb; do
  if [[ ! -x "$pg_bin/$binary" ]]; then
    printf 'Missing PostgreSQL 16 binary: %s\n' "$pg_bin/$binary" >&2
    exit 1
  fi
done

if ! "$pg_bin/pg_isready" --host "$pg_host" --port "$pg_port" --username "$pg_user" >/dev/null; then
  printf 'Disposable PostgreSQL is not ready at %s:%s. Start only the documented disposable cluster before retrying.\n' "$pg_host" "$pg_port" >&2
  exit 1
fi

"$pg_bin/dropdb" --if-exists --no-password --maintenance-db postgres \
  --host "$pg_host" --port "$pg_port" --username "$pg_user" "$test_db"
"$pg_bin/createdb" --no-password --host "$pg_host" --port "$pg_port" \
  --username "$pg_user" "$test_db"

"$pg_bin/psql" --no-password -X -v ON_ERROR_STOP=1 \
  --host "$pg_host" --port "$pg_port" --username "$pg_user" --dbname "$test_db" \
  --file "$repo_root/ops/db/bootstrap.sql"

"$pg_bin/psql" --no-password -X -v ON_ERROR_STOP=1 \
  --host "$pg_host" --port "$pg_port" --username "$pg_user" --dbname "$test_db" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'first_user_provisioner') THEN
    EXECUTE 'CREATE ROLE first_user_provisioner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'first_user_unrelated') THEN
    EXECUTE 'CREATE ROLE first_user_unrelated LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  END IF;
END
$$;

ALTER ROLE first_user_provisioner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE first_user_provisioner RESET ALL;
ALTER ROLE first_user_unrelated LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE first_user_unrelated RESET ALL;
ALTER ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE app_runtime RESET ALL;

DO $$
DECLARE
  granted_role name;
BEGIN
  FOR granted_role IN
    SELECT parent.rolname
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'first_user_provisioner'
  LOOP
    EXECUTE format('REVOKE %I FROM first_user_provisioner', granted_role);
  END LOOP;
END
$$;
SQL

(cd "$repo_root" && \
  DATABASE_DIRECT_URL="postgresql://${pg_user}@${pg_host}:${pg_port}/${test_db}" \
  pnpm exec drizzle-kit migrate --config drizzle.config.ts)

"$pg_bin/psql" --no-password -X -v ON_ERROR_STOP=1 \
  --host "$pg_host" --port "$pg_port" --username "$pg_user" --dbname "$test_db" <<'SQL'
INSERT INTO app.tenants (id, name, slug, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Synthetic Tenant A', 'synthetic-tenant-a', 'ACTIVE'),
  ('22222222-2222-4222-8222-222222222222', 'Synthetic Tenant B', 'synthetic-tenant-b', 'ACTIVE'),
  ('33333333-3333-4333-8333-333333333333', 'Synthetic Tenant C', 'synthetic-tenant-c', 'ACTIVE');

INSERT INTO app.legal_entities (id, tenant_id, legal_name, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Synthetic Legal Entity A', 'ACTIVE'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', '11111111-1111-4111-8111-111111111111', 'Synthetic Legal Entity A2', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Synthetic Legal Entity B', 'ACTIVE'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', 'Synthetic Legal Entity C', 'ACTIVE');

INSERT INTO app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SYN-A', 'Synthetic Station A', 'Africa/Harare', 'ACTIVE'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'SYN-A2', 'Synthetic Station A2', 'Africa/Harare', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SYN-B', 'Synthetic Station B', 'Africa/Harare', 'ACTIVE'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '33333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'SYN-C', 'Synthetic Station C', 'Africa/Harare', 'ACTIVE');

DO $$
DECLARE
  required_permissions constant text[] := ARRAY[
    'tenant.context.select', 'tenant.view', 'legal_entity.view', 'station.view',
    'business_day.view', 'shift.view', 'supplier.view', 'supplier.creditor.review',
    'inventory.view', 'provider.settlement.view', 'cash.collection.view',
    'cash.deposit.view'
  ];
  permission_count integer;
  exposed_function_count integer;
BEGIN
  SELECT count(*) INTO permission_count
  FROM platform.permission_definitions
  WHERE code = ANY(required_permissions);
  IF permission_count <> cardinality(required_permissions) THEN
    RAISE EXCEPTION 'required first-user permission fixture is incomplete';
  END IF;

  SELECT count(*) INTO exposed_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform'
    AND p.proname LIKE 'first_user_provisioning_%'
    AND has_function_privilege('first_user_provisioner', p.oid, 'EXECUTE');
  IF exposed_function_count <> 8 THEN
    RAISE EXCEPTION 'first-user provisioner function grants are incomplete';
  END IF;

  IF NOT has_database_privilege('first_user_provisioner', current_database(), 'CONNECT')
     OR NOT has_schema_privilege('first_user_provisioner', 'platform', 'USAGE')
     OR has_schema_privilege('first_user_provisioner', 'app', 'USAGE')
     OR has_schema_privilege('first_user_provisioner', 'auth', 'USAGE')
  THEN
    RAISE EXCEPTION 'first-user provisioner role grants are unsafe or incomplete';
  END IF;
END
$$;
SQL

printf 'Disposable first-user PostgreSQL fixture ready: %s:%s/%s\n' "$pg_host" "$pg_port" "$test_db"
