# First-user provisioning evidence and reproducibility review

Status: **READY FOR FINAL REVIEW**

The architecture review is accepted; this follow-up closes only the evidence
and reproducibility gaps. Verification used only disposable PostgreSQL 16.15 at
`127.0.0.1:55432`; no production, Neon, deployment, push, merge, or production
user action occurred.

- Release base: `3a6935af5d4d79cf806e3b69e24ab910ffcf562a`
- Previous blocked commit: `552398175b840ce2a8149a8aaf211c0272b6b71e`
- Implementation and reproducibility commit: `2062848143eb676e6f5a70c42b34d47775bdca3f`
- Migration: `src/platform/db/migrations/0021_security_first_user_provisioning.sql`
- Migration SHA-256: `a51bee68bbfec23cfeabaa7a54039aca3672b7e8b4e386a5d2c36b01bd5d7caa`
- Evidence: `evidence/first-user-provisioning-postgres.md`
- Deterministic setup: `tests/integration/fixtures/first-user-provisioning-setup.sh`
- Deterministic runner: `tests/integration/fixtures/first-user-provisioning-run.sh`

## Hardened design

- `first_user_provisioner` receives only `CONNECT`, platform schema `USAGE`,
  and EXECUTE on the fixed reviewed API. It receives no application-table
  privileges, schema `CREATE`, role membership, ownership, or SET ROLE path.
- All privileged writes run inside `migration_owner` SECURITY DEFINER
  functions with fixed `search_path = pg_catalog, platform, app, auth`.
- The old `app.first_user_provisioning_*` GUCs, `session_user` authority check,
  and caller-activated bootstrap RLS policies are removed.
- The only bootstrap RLS policies match the trusted definer owner
  `current_user = 'migration_owner'`; the provisioner cannot activate them.
- Runtime and migration-time catalog checks fail closed for unsafe role
  attributes, memberships, owners, direct table grants, schema CREATE, and
  unexpected function EXECUTE.
- `platform.first_user_provisioning_operations` provides a unique tenant
  sentinel. It is inserted atomically, remains after revoke, and permanently
  prevents replay, disabled-membership reopening, or grant deletion reopening.
- Provision inserts the fixed twelve read-only permissions inside the database;
  callers cannot submit permission names.
- Revoke accepts no grant IDs. It derives the operation-owned grants from the
  immutable operation record, validates every exact permission/scope tuple,
  refuses tampering or unrelated grants, preserves unrelated sessions, and
  retains audit evidence.

## Verification result

- PostgreSQL integration/adversarial suite: **9 passed, 0 skipped**.
- Success audit persistence after commit: **PASS**.
- Failure audit persistence after commit, with actor/subject/tenant/scope and
  secret-absence assertions: **PASS**.
- The committed fixture recreates the disposable database, role attributes,
  grants, canonical migrations, synthetic A/B/C hierarchy, and permission
  prerequisites without undocumented terminal SQL.
- Covered security properties: role membership drift, SET ROLE path, direct
  table privilege drift, old-GUC attempts, direct membership/grant/audit and
  unrelated application writes, PUBLIC/app-runtime/unrelated helper denial,
  fixed permission rejection, provider permission absence, foreign tenant,
  foreign legal entity, foreign station, duplicate bootstrap, one-time
  sentinel, disabled-membership reopening, concurrent bootstrap, operation
  replay, tampered revoke state, unrelated grant/session preservation, expiry,
  success audit, failure audit, and full transaction rollback.
- Focused unit tests: **13 passed**.
- TypeScript: **passed**.
- Drizzle migration validation: **passed**.
- ESLint, Prettier, and `git diff --check`: **passed**.
- Security-critical skipped tests: **0**.

The test database contained only synthetic tenants, legal entities, stations,
users, and sessions. No production credentials, identifiers, secrets, or real
user data were used.
