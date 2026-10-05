# First-user provisioning PostgreSQL evidence

Result: **PASS**

This is non-secret evidence from the disposable local PostgreSQL 16.15 cluster
at `127.0.0.1:55432`, database `shanda_fuel_first_user_test`. The cluster was
reset before the run. No production or Neon database was contacted.

## Source and migration

- Release base: `3a6935af5d4d79cf806e3b69e24ab910ffcf562a`
- Previous bootstrap commit under review: `552398175b840ce2a8149a8aaf211c0272b6b71e`
- Migration: `src/platform/db/migrations/0021_security_first_user_provisioning.sql`
- Migration SHA-256: `a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa`
- Migration history: 0021 applied successfully through `drizzle-kit migrate`.

## Role and catalog evidence

- PostgreSQL version: `PostgreSQL 16.15`.
- `first_user_provisioner`: LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE,
  NOCREATEDB, NOINHERIT, NOREPLICATION, no role configuration.
- Database owner: **NO**.
- Schema owner: **NO**.
- Relation owner: **NO**.
- Role memberships: **0**.
- Direct table grants in `app`, `auth`, and `platform`: **0**.
- Application and operation tables checked: all 9 have `relrowsecurity=true`
  and `relforcerowsecurity=true`.
- Bootstrap functions: owned by `migration_owner`; SECURITY DEFINER functions
  use `search_path=pg_catalog, platform, app, auth`.
- PUBLIC, `app_runtime`, and `first_user_unrelated` EXECUTE on bootstrap
  functions: **none**.
- Old bootstrap GUC/session-user references in bootstrap functions: **0**.
- Bootstrap policies are fixed to `current_user = 'migration_owner'`; no
  caller-set GUC or `session_user` policy path exists.

## Reproducible command

After applying `ops/db/bootstrap.sql`, creating the disposable roles, applying
the canonical migrations, and inserting only synthetic fixture IDs, a reviewer
can reproduce the security suite with this single command. All URLs are local,
passwordless test URLs; no secret is included.

```sh
APP_ENV=local \
FIRST_USER_PROVISIONING_TEST_DATABASE=true \
DATABASE_URL='postgresql://first_user_provisioner@127.0.0.1:55432/shanda_fuel_first_user_test' \
FIRST_USER_PROVISIONING_TEST_ADMIN_DATABASE_URL='postgresql://wolftech@127.0.0.1:55432/shanda_fuel_first_user_test' \
FIRST_USER_PROVISIONING_TEST_APP_RUNTIME_DATABASE_URL='postgresql://app_runtime@127.0.0.1:55432/shanda_fuel_first_user_test' \
FIRST_USER_PROVISIONING_TEST_UNRELATED_DATABASE_URL='postgresql://first_user_unrelated@127.0.0.1:55432/shanda_fuel_first_user_test' \
FIRST_USER_PROVISIONING_TEST_TENANT_ID='11111111-1111-4111-8111-111111111111' \
FIRST_USER_PROVISIONING_TEST_LEGAL_ENTITY_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' \
FIRST_USER_PROVISIONING_TEST_STATION_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' \
FIRST_USER_PROVISIONING_TEST_CROSS_TENANT_ID='22222222-2222-4222-8222-222222222222' \
FIRST_USER_PROVISIONING_TEST_CROSS_TENANT_LEGAL_ENTITY_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' \
FIRST_USER_PROVISIONING_TEST_CROSS_TENANT_STATION_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' \
FIRST_USER_PROVISIONING_TEST_CROSS_ENTITY_STATION_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' \
FIRST_USER_PROVISIONING_TEST_ROLLBACK_TENANT_ID='33333333-3333-4333-8333-333333333333' \
FIRST_USER_PROVISIONING_TEST_ROLLBACK_LEGAL_ENTITY_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc' \
FIRST_USER_PROVISIONING_TEST_ROLLBACK_STATION_ID='cccccccc-cccc-4ccc-8ccc-ccccccccccc1' \
./node_modules/.bin/vitest run --config vitest.integration.config.ts tests/integration/first-user-provisioning.test.ts --reporter verbose
```

## Required security properties

| Property                                                         | Result |
| ---------------------------------------------------------------- | ------ |
| Unsafe role attributes fail closed                               | PASS   |
| Unexpected role membership and SET ROLE path fail closed         | PASS   |
| Unexpected direct table privilege fails closed                   | PASS   |
| Caller-set old GUCs gain no access                               | PASS   |
| Direct membership, grant, audit, and application writes denied   | PASS   |
| PUBLIC, app-runtime, and unrelated-role helper invocation denied | PASS   |
| Exact tenant → legal entity → station hierarchy enforced         | PASS   |
| Fixed twelve-grant allowlist enforced in the database            | PASS   |
| Provider/write/admin/unknown permission paths rejected or absent | PASS   |
| Database-enforced one-time tenant sentinel                       | PASS   |
| Disabled membership cannot reopen bootstrap                      | PASS   |
| Concurrent bootstrap allows one success                          | PASS   |
| Reused operation ID rejected                                     | PASS   |
| Revoke derives grants from operation, without caller grant IDs   | PASS   |
| Tampered operation grant state rejected safely                   | PASS   |
| Unrelated grants and sessions preserved                          | PASS   |
| Grant expiry enforced                                            | PASS   |
| Success audit persisted                                          | PASS   |
| Failure audit persisted                                          | PASS   |
| Full transaction rollback leaves no user                         | PASS   |
| FORCE RLS preserved                                              | PASS   |
| Security-critical skipped tests                                  | 0      |

Final integration result: **9 tests passed**. Focused unit result: **13 tests
passed**. TypeScript and Drizzle migration validation: **passed**. No
production user was created and nothing was pushed, merged, or deployed.
