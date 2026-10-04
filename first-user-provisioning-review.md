# First production user provisioning hardening review

Status: **SCRIPT HARDENED / BLOCKED**. The local tool and focused tests were
hardened on the isolated branch below. The tool was not run against any
database, has not created or revoked a user, and has not been deployed.

- Branch: `plan/first-production-user`
- Base SHA: `3a6935af5d4d79cf806e3b69e24ab910ffcf562a`
- Local commit SHA: `9d4eeac` (the local commit object created for this handoff)
- Production `main` changed: **NO**
- Production/staging/Neon contacted: **NO**

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

This repository does not create that operator role or solve the first-member
RLS bootstrap capability. That missing external role/capability is an
operational prerequisite and is why this task remains blocked. The hardening
does not use a superuser, `BYPASSRLS`, `row_security=off`, policy changes, or
an environment-variable role override.

The write transaction locks the tenant, legal entity, and station rows in
deterministic hierarchy order with `FOR UPDATE`, then revalidates active
status and exact relationships before mutation. Dry-run retains
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

## Tests and validation

Added coverage includes:

- focused unit tests for the exact grant set and absence of `provider.view`,
  duplicate refusal, hierarchy mismatch, simulated rollback, operation-scoped
  revoke, unrelated-grant refusal, additional-membership/session safety,
  superuser/BYPASSRLS/unapproved-role rejection, hidden TTY input/no echo,
  no-TTY refusal, argv/error redaction, confirmation parsing, and Better Auth
  hash/verify semantics;
- an opt-in PostgreSQL integration suite for role metadata, read-only dry-run,
  transactional rollback, exact grant/expiry evidence, absence of
  `provider.view`, and audit actor/subject evidence. It requires
  `APP_ENV=local`, `FIRST_USER_PROVISIONING_TEST_DATABASE=true`,
  `DATABASE_URL`, and explicit synthetic fixture IDs; it never runs against
  production.

Validation state for this checkout:

- Prettier: **passed repository-wide** with `prettier --check .` using the
  existing shared dependency binary.
- Focused unit tests: **13 passed** using the existing shared dependency
  installation through a temporary, non-repository module-resolution harness;
  the isolated worktree itself was not modified with dependencies.
- PostgreSQL integration suite: **3 skipped** by its explicit safety gate; no
  `DATABASE_URL`, no `APP_ENV`, and no safe test database were present. No
  database contact was attempted.
- `pnpm lint`: **not executed** in the isolated worktree because its ESLint
  config dependencies are absent. No offline installation was attempted.
- Targeted TypeScript check for the hardened tool and tests: **passed** using
  the existing shared dependency type declarations through a temporary,
  non-repository config. Repository-wide TypeScript remains unverified.

No signup, bootstrap, deployment, push, production user action, or independent
re-review was performed. The next implementation owner remains A0. Actual
execution still requires an approved non-superuser/NOBYPASSRLS operator role,
synthetic local test fixtures for integration validation, and separately
approved client tenant/legal-entity/station, operator, expiry, database, and
audit-key values.
