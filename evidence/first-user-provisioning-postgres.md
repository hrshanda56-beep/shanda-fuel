# First-user provisioning PostgreSQL evidence

Result: **PASS**

This is non-secret evidence from the disposable local PostgreSQL 16.15 cluster
at `127.0.0.1:55432`, database `shanda_fuel_first_user_test`. The cluster was
reset by the committed fixture before the run. No production or Neon database
was contacted.

## Source and migration

- Release base: `3a6935af5d4d79cf806e3b69e24ab910ffcf562a`
- Previous bootstrap commit under review: `552398175b840ce2a8149a8aaf211c0272b6b71e`
- Implementation and reproducibility commit: `2062848143eb676e6f5a70c42b34d47775bdca3f`
- Migration: `src/platform/db/migrations/0021_security_first_user_provisioning.sql`
- Migration SHA-256: `a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa`
- Migration history: 0021 applied successfully through `drizzle-kit migrate`.
- Migration 0021 was unchanged in this evidence pass.

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

## Reproducible commands

From a clean local PostgreSQL 16 instance at the endpoint above, the setup
command recreates the named disposable database, applies `ops/db/bootstrap.sql`
and all canonical migrations, creates the restricted test roles, and inserts
only synthetic Tenant A/B/C, Legal Entity, and Station fixtures. It also checks
the required permission definitions and function grants.

```sh
bash tests/integration/fixtures/first-user-provisioning-setup.sh
```

The test command derives all local connection settings and synthetic fixture
IDs from the committed runner; it contains no password or external endpoint.

```sh
bash tests/integration/fixtures/first-user-provisioning-run.sh
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
| Failure audit persisted after a committed transaction            | PASS   |
| Full transaction rollback leaves no user                         | PASS   |
| FORCE RLS preserved                                              | PASS   |
| Security-critical skipped tests                                  | 0      |

Final integration/adversarial result: **9 tests passed, 0 skipped**. The
success-audit test and the committed failure-audit persistence test both passed.
Focused unit result: **13 tests passed**. TypeScript, ESLint, Prettier, and
Drizzle migration validation: **passed**. No production user was created and
nothing was pushed, merged, or deployed.

Evidence is non-secret and contains no credential material, production IDs, or
real user data.
