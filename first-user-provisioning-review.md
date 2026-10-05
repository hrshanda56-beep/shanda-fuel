# First production user provisioning hardening review

Status: **POSTGRESQL VERIFIED**. The local tool and narrow database capability
were exercised against a disposable PostgreSQL 16.15 database on the isolated
branch below. No production or Neon database was contacted, and no production
user was created.

- Branch: `plan/first-production-user`
- Base SHA: `3a6935af5d4d79cf806e3b69e24ab910ffcf562a`
- Local commit SHA: reported from `git rev-parse HEAD` after commit creation; intentionally not embedded here because that would make the commit hash self-referential.
- Production `main` changed: **NO**
- Production/staging/Neon contacted: **NO**
- Migration: `0021_security_first_user_provisioning.sql`

## Authorization and exact grant set

The tool creates no role assignments and no wildcard, write, admin, or
provider-configuration permissions. The exact temporary grant plan is:

| Permission                 | Scope        |
| -------------------------- | ------------ |
| `tenant.context.select`    | TENANT       |
| `tenant.view`              | TENANT       |
| `legal_entity.view`        | LEGAL_ENTITY |
| `station.view`             | STATION      |
| `business_day.view`        | STATION      |
| `shift.view`               | STATION      |
| `supplier.view`            | LEGAL_ENTITY |
| `supplier.creditor.review` | LEGAL_ENTITY |
| `inventory.view`           | STATION      |
| `provider.settlement.view` | STATION      |
| `cash.collection.view`     | STATION      |
| `cash.deposit.view`        | STATION      |

`provider.view` was removed because no current release path requires it.
Permission definitions are checked by exact code before writes. Every grant has
the selected tenant-aware scope, an explicit expiry no more than two hours
from database time, and a reason containing a fresh operation UUID:
`first-production-user-provisioning:<operation-id>`.

## Database role and RLS contract

Before inspect, dry-run, provision, or revoke, the script reads `pg_roles` for
the current connection and fails closed if `rolsuper` or `rolbypassrls` is
true. There is no override. The only accepted role name is
`first_user_provisioner`, which must be `NOSUPERUSER`, `NOBYPASSRLS`, have only
the separately reviewed grants/capability needed for this operation, and be
used only from an approved local connection. The repository's bootstrap roles
(`app_runtime`, `job_runtime`, and `diagnostics_readonly`) are not accepted.

Migration `0021_security_first_user_provisioning.sql` now provides the missing
capability without weakening `FORCE ROW LEVEL SECURITY`. It adds fixed
`SECURITY DEFINER` helpers owned by `migration_owner`, validates
`session_user = first_user_provisioner`, and grants the dedicated role only
`platform` schema usage plus execute on scope discovery, identity/permission
inspection, atomic provision, atomic revoke, and constrained failure-audit
helpers. The role receives no table privileges, and the helper functions
revalidate the active tenant → legal entity → station hierarchy, refuse any
existing non-disabled tenant membership, create exactly the twelve fixed
read-only grants, and reject arbitrary direct table writes.

The role itself remains an environment-bootstrap responsibility. Before the
migration is applied, a disposable/local PostgreSQL owner must create
`first_user_provisioner` as `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
NOCREATEROLE NOINHERIT NOREPLICATION`, with no schema/table ownership and no
privileges beyond the migration's execute grants and database/schema access.
The migration verifies the role attributes when the role exists; it never uses
the operator role to manage roles. The hardening does not use a superuser,
`BYPASSRLS`, `row_security=off`, policy changes at runtime, or an
environment-variable role override.

The write transaction locks the tenant, legal entity, and station rows in
deterministic hierarchy order with `FOR UPDATE`, then revalidates active
status and exact relationships before mutation. The migration adds only
capability-scoped update policies needed for those row locks. Dry-run retains
`SET TRANSACTION READ ONLY` and uses unlocked reads; it cannot write.

## Password, Better Auth, and CLI safety

- Password input uses direct raw TTY stdin/stdout, never `readline` with a
  visible output stream. Characters are not echoed; CR/LF completes input and
  raw mode is restored. Missing stdin/stdout TTY fails closed.
- There is no password option, environment variable, audit field, output
  field, or password-hash log. The password is cleared from the local
  variable after the transaction.
- Credential persistence remains Better Auth `1.7.5` shape:
  `provider_id='credential'`, `account_id=<user id>`, and a hash from
  `better-auth/crypto`. No session, cookie, email-verification claim, or MFA
  state is inserted.
- CLI parsing does not reflect arbitrary unknown arguments. A central safe
  formatter emits controlled validation messages and a generic classified
  failure for raw database/unknown errors; database URLs, URL passwords,
  credential values, raw PostgreSQL errors, and arbitrary argv values are not
  printed.
- Provision and dry-run require explicit production confirmation. Revoke
  additionally requires the exact email, user UUID, operation UUID, and full
  hierarchy scope.

## Revoke and session scope

Cleanup is operation-scoped, not permission-name-scoped. It loads every
unrevoked grant for the exact tenant/membership, requires exactly one matching
grant for every expected permission/scope/reason, and updates only the exact
grant IDs found for the supplied operation UUID. Any unrelated unrevoked grant
causes a safe refusal before writes; unrelated grants are not deleted.

The target identity must have exactly one membership and no role assignments.
Only then are that identity's sessions revoked; this is safe because the
temporary release account is the sole access context. An identity with another
membership is refused, so unrelated user sessions and access contexts remain
untouched. Cleanup then appends a signed event and disables the target
membership. Repeating a completed cleanup returns `already-disabled` without
additional writes.

## Audit evidence

Provisioning and revoke audit events use the repository's signed security-event
contract. The local support/operator actor is represented by
`actorType: SUPPORT`, `initiatedBy: first-production-user-provisioning`, and
no target-user `actorId`; the target user is represented separately as
`subjectType: auth.user` and `subjectId`. Metadata records the operation UUID,
target membership, legal entity, station, exact permission codes, expiry, and
outcome. Failure events contain only the mode, requested scope, and classified
error type. No password, hash, database URL, session, cookie, or secret is
included.

The previous failure-audit path attempted a normal tenant-context insert before
an active membership existed, so `security_events_context` rejected it under
`FORCE ROW LEVEL SECURITY`. The new failure helper accepts only a known active
tenant, writes only `ACCESS.PROVISIONING_FAILED`, uses `SUPPORT` attribution
with a null actor and no membership, and is itself callable only by the
dedicated role. If tenant selection is not known or the tenant is not active,
the tool records no fabricated tenant event and reports the failure locally.

## Tests and validation

Added coverage includes:

- focused unit tests for the exact grant set and absence of `provider.view`,
  duplicate refusal, hierarchy mismatch, simulated rollback, operation-scoped
  revoke, unrelated-grant refusal, additional-membership/session safety,
  superuser/BYPASSRLS/unapproved-role rejection, hidden TTY input/no echo,
  no-TTY refusal, argv/error redaction, confirmation parsing, and Better Auth
  hash/verify semantics;
- an opt-in PostgreSQL integration suite for role metadata, read-only dry-run,
  filtered capability reads, fixed-allowlist rejection, app-runtime denial,
  FORCE-RLS verification, successful first-user creation, duplicate refusal,
  exact grant inspection, transactional rollback, and tenant-scoped failure
  audit insertion. It requires
  `APP_ENV=local`, `FIRST_USER_PROVISIONING_TEST_DATABASE=true`, the operator
  `DATABASE_URL`, explicit non-production admin and `app_runtime` test URLs,
  and synthetic fixture IDs; it never runs against production.

Validation state for this checkout:

- Prettier: **passed** for all changed TypeScript, JSON, and Markdown files
  using the existing shared dependency binary.
- Focused unit tests: **13 passed** using the existing shared dependency
  installation through a temporary, non-repository module-resolution harness;
  the isolated worktree itself was not modified with dependencies.
- PostgreSQL integration suite: **7 passed** against
  `shanda_fuel_first_user_test` on PostgreSQL 16.15 at `127.0.0.1:55432`.
  The suite used only synthetic Tenant A/B fixtures and the restricted
  `first_user_provisioner` connection for provisioning.
- PostgreSQL adversarial probes: **passed**. Unknown/write permission
  requests, cross-tenant/entity scopes, helper calls as `app_runtime` and an
  unrelated role, direct provisioner writes, and runtime writes were rejected
  or returned zero rows; catalog checks confirmed no forbidden row changes.
- PostgreSQL catalog verification: **passed**. Migration 0021 is recorded,
  all seven touched tables remain RLS-enabled and FORCE-RLS, the provisioner
  is not a database/schema/relation owner, and SECURITY DEFINER functions have
  `migration_owner` ownership, explicit safe search paths, and no PUBLIC,
  `app_runtime`, or unrelated-role EXECUTE privilege.
- `pnpm lint`: **not executed** in the isolated worktree because its ESLint
  config dependencies are absent. No offline installation was attempted.
- Targeted TypeScript check for the hardened tool and tests: **passed**.
- Drizzle migration validation: **passed**.

No signup, deployment, push, production user action, or independent re-review
was performed. The next implementation owner remains A0. Production use still
requires separate approval and client-provided tenant/legal-entity/station,
operator, expiry, database, and audit-key values.
