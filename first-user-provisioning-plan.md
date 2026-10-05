# First production user provisioning plan

Status: plan superseded by the narrow hardening pass documented in
`first-user-provisioning-review.md`. No production action has been taken, no
credentials were requested or printed, and no production application files
were changed.

The four-grant release-smoke recommendation later in this historical plan is
superseded for the hardened implementation by the explicit 12-permission
read-only plan in `first-user-provisioning-review.md`.

## Hardening decisions and remaining blocker

- The accepted direct connection role is exactly `first_user_provisioner`,
  and it must be `NOSUPERUSER` and `NOBYPASSRLS`. The tool rejects
  `rolsuper`, `rolbypassrls`, `app_runtime`, `job_runtime`,
  `diagnostics_readonly`, and every other role name. There is no override.
- The tool now reads passwords through a direct raw TTY reader with no echo,
  fails closed without a TTY, and uses a central safe error formatter.
- Provisioning uses an explicit 12-permission read-only plan with no
  `provider.view`; every grant carries an operation UUID in its reason and an
  expiry no more than two hours from database time.
- Write transactions lock and revalidate the selected tenant, legal entity,
  and station. Dry-run keeps `SET TRANSACTION READ ONLY` and performs no
  writes.
- Revoke requires the exact temporary user UUID and operation UUID, matches
  exact grant IDs and hierarchy scope, refuses unrelated unrevoked grants,
  and only revokes sessions when the identity has exactly one membership.
- Audit events use the local support/operator convention with no target-user
  `actorId`; the target is recorded as the separate subject.

The repository does not create `first_user_provisioner` or provide the
reviewed RLS-safe first-membership capability it would need. That external
role/capability and a safe synthetic PostgreSQL test database are prerequisites
for execution, so the hardening task remains blocked without contacting
production.

## Scope and release baseline

- Agent: Access
- Worktree: `/Users/wolftech/.codex/worktrees/first-user-provisioning/shanda-fuel`
- Branch: `plan/first-production-user`
- Base: `origin/main` / `3a6935af5d4d79cf806e3b69e24ab910ffcf562a`
- Target: `https://fuel.shandahr.com`
- Auth provider: Better Auth `1.7.5`, backed by Drizzle ORM and PostgreSQL
- Required outcome: one legitimate operator can use the normal production
  login page and run the existing read-only release smoke harness.

This plan does not create a user, alter production, deploy, change auth
configuration, enable signup, restore the retired staging bootstrap, or
weaken trusted origins/security settings.

## Current authentication architecture

The application owns one Better Auth server configuration in
`src/platform/auth/server.ts`:

- Better Auth is created server-side from the `better-auth/minimal` entry
  point.
- Persistence uses `drizzleAdapter(getDatabase(), { provider: 'pg', schema:
authTables, schemaName: 'auth', transaction: true })`.
- The production base URL is the only trusted origin.
- Production uses secure cookies with the `shanda-fuel` cookie prefix.
- Email/password authentication is enabled.
- The TOTP `twoFactor` plugin is enabled with passwordless login disabled,
  verification-on-enable disabled, and account lockout after ten failed
  attempts for fifteen minutes.
- Sessions last seven days, with the existing server-only assurance and
  tenant-binding fields.

The catch-all route `src/app/api/auth/[...all]/route.ts` delegates normal
Better Auth GET/POST handling and applies the existing persistent auth rate
limit. `src/app/login/page.tsx` exposes only email/password sign-in. Browser
code never connects to PostgreSQL.

## Signup findings

1. Email/password authentication is technically configured, but email/password
   self-signup is **not enabled**. `emailAndPassword.enabled` is `true` while
   `disableSignUp` is bound to `AUTH_SECURITY_POLICY.publicSignUpDisabled`,
   which is `true` in `src/platform/auth/server.ts`.
2. Signup is disabled at the Better Auth server/auth layer, not only hidden in
   the UI. The UI has no signup page, and the server configuration rejects the
   public signup path.
3. There is no configured Better Auth admin plugin, organization plugin, or
   application-facing `createUser`/provisioning service. The application uses
   Better Auth server APIs for session reads, password/TOTP verification,
   session revocation, and the normal auth route, but not for administrator
   user creation.
4. `package.json` contains no user-provisioning command. The current `scripts/`
   tree contains no provisioning or seed utility for production users.
5. There is no implemented invitation flow. `membership.invite` exists in the
   permission catalogue and role seed, but there is no invitation table,
   invitation route, membership-management route, email invitation workflow,
   or command that implements it.

Therefore the answers to the mechanism questions are:

| Question                                                                                              | Finding                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Server-side public signup enabled?                                                                    | **NO**                                                                                                        |
| Existing provisioning script?                                                                         | **NO**                                                                                                        |
| Existing admin/server create-user API?                                                                | **NO** (the generic Better Auth signup API is intentionally disabled; no admin create-user API is configured) |
| Existing invitation flow?                                                                             | **NO**                                                                                                        |
| Can the first user be created through the current supported application paths without direct DB work? | **NO**                                                                                                        |

## Authorization records required

Authentication alone does not create tenant access. The current authorization
chain is Better Auth session → authenticated identity → active tenant
membership → role assignment or temporary permission grant → trusted tenant
context → PostgreSQL RLS.

The exact records to check and, only if absent and approved, create are:

1. An `auth.user` identity with the approved operator name and email. Email is
   unique. `email_verified` may remain at the current default unless an
   approved email-verification policy requires otherwise; do not invent a
   verification claim.
2. An `auth.account` credential row linked to that user, with the Better Auth
   email/password provider shape and a password hash produced by the official
   `better-auth/crypto` `hashPassword` helper. The current retired bootstrap
   recorded the compatible shape as `provider_id='credential'` and
   `account_id=<user id>`; the one-shot implementation must assert the locked
   Better Auth `1.7.5` package shape before writing.
3. An `app.memberships` row linking the identity to exactly one approved
   tenant, with status `ACTIVE`. The tenant must already exist and be `ACTIVE`.
   The unique `(tenant_id, identity_id)` constraint and the composite tenant
   foreign keys must be respected.
4. Authorization for the approved scope. There is no separate legal-entity
   membership or station-membership table. Scope is represented by
   `app.membership_role_assignments` and/or expiring
   `app.temporary_permission_grants`, with the hierarchy enforced by
   composite foreign keys and scope checks.
5. The approved legal entity and station must already exist, be active, and
   belong to the selected tenant. The station row carries the legal-entity
   binding; a station scope must carry both `legal_entity_id` and `station_id`.
6. A Better Auth `auth.session` must **not** be inserted by the provisioner.
   The operator will sign in through the normal HTTPS login flow so Better Auth
   creates the session and cookie.
7. MFA state must **not** be inserted or forged. If the approved role needs
   strong authentication, the operator enrolls TOTP through the existing
   authenticated setup and verification routes. High-risk authorization fails
   closed until the server has verified the required assurance.
8. Where the tenant-scoped audit stream is applicable, append one signed
   `platform.security_events` record using the existing
   `src/modules/audit/contracts.ts` / `src/platform/security/audit-signing.ts`
   path. The event must identify the one-shot operator tool and target record,
   but must never contain the password or password hash. If the required audit
   append cannot be made consistently, the transaction must roll back.

For the stated release verification, the existing harness performs only the
authenticated `GET /api/forecourt/operations/overview` check. Its server path
requires `business_day.view` and `shift.view` at the station scope; context
discovery additionally needs `tenant.context.select` and `station.view` for
the selected station. The least-privilege release-only authorization is thus:

- one `ACTIVE` membership in the approved tenant; and
- four explicitly named, station-scoped, short-lived grants:
  `tenant.context.select`, `station.view`, `business_day.view`, and
  `shift.view`.

Those grants are appropriate only if the release owner confirms that this
account is for read-only verification. They must have an explicit expiry and
must not be replaced with OWNER, ADMINISTRATOR, or a tenant-wide wildcard
grant. A long-lived business operator account requires a separately approved
role and scope; the repository does not contain client master-data or role
approval values from which to invent one.

## Direct database and Better Auth invariants

Direct persistence is the only available mechanism in the current codebase,
but it is risky and must remain a one-shot local operation. Important
invariants include:

- `auth.user.email` is unique; an existing email must cause a safe refusal,
  not an overwrite or reassignment.
- `auth.account` has a unique `(provider_id, account_id)` pair and a foreign
  key to `auth.user`. The credential row must link to the same identity and
  use the exact Better Auth credential provider/account shape.
- The password column must contain a Better Auth-compatible hash, never
  plaintext, a binary-float-derived value, or a hash copied from elsewhere.
  Use `hashPassword` from the pinned Better Auth package and, in a test/local
  preflight, verify it with the matching `verifyPassword` helper.
- `auth.session` tokens are unique, signed/validated by Better Auth, and have
  expiry and assurance fields. Hand-inserting one or manufacturing a cookie
  would bypass normal session behavior and is prohibited.
- `auth.two_factor` and `auth.user.two_factor_enabled` are Better Auth plugin
  state. Do not hand-create TOTP secrets or backup codes.
- `app.memberships.identity_id` must equal the Better Auth user ID, the
  membership must be `ACTIVE`, and the tenant must be the approved tenant.
  `INVITED`, `SUSPENDED`, `LOCKED`, and `DISABLED` memberships fail closed.
- Role/grant rows must use valid permission definitions and a valid
  tenant/legal-entity/station hierarchy. Cross-tenant or mismatched composite
  references must be rejected before any write.
- Tenant RLS depends on a valid actor, tenant, and membership context. The
  one-shot writer must set and verify a transaction-local context only for the
  intended target and must never use an application request parameter as
  authority.
- Security events are append-oriented and HMAC signed. Never update/delete an
  existing event or log a password, hash, session token, cookie, or secret.

The first membership cannot be inserted through the normal `app_runtime` RLS
path because that membership does not yet exist to establish an active RLS
context. The hardened local tool therefore accepts only the exact
`first_user_provisioner` role, after verifying `rolsuper=false` and
`rolbypassrls=false`. That role must be externally created with a separately
reviewed RLS-safe first-membership capability; this repository does not create
it. Superuser, `BYPASSRLS`, `row_security=off`, policy changes, and runtime-role
overrides remain prohibited.

The retired staging implementation is useful architectural evidence only. It
used `hashPassword`, checked the full synthetic tenant hierarchy and active
membership before mutation, created the user and credential row transactionally,
and avoided creating a session. It was removed by the final staging cleanup
(`19735bc` / `8db43b7` lineage); `scripts/staging-auth-smoke-bootstrap.ts` and
`src/platform/staging/auth-smoke-bootstrap.ts` are absent from this release.
Its staging-only command, synthetic IDs, temporary grants, and environment
guards must not be copied into production.

## Recommended safest mechanism

Use a narrowly written, operator-run, **local-only one-shot provisioning
script**, created and reviewed only when provisioning is separately approved.
It is not a public route, not a permanent signup page, not a package command,
and not a deployment artifact.

The script should use:

- the pinned Better Auth `hashPassword` helper;
- the existing `postgres` dependency and a direct, owner-approved database
  connection supplied outside the repository;
- one database transaction with a read-only preflight before mutation;
- the current auth/app schema and constraints from
  `src/platform/db/schema/auth.ts`, `src/platform/db/schema/a1.ts`, and the
  canonical migrations; and
- the existing HMAC audit helpers for a signed provisioning event where the
  tenant-scoped audit contract permits it.

The script must accept only explicit operator-supplied target identifiers and
an approved email; it must refuse to infer a tenant, legal entity, station,
role, or email from “first row” queries. It must refuse production unless a
separate explicit production confirmation is present, and it must refuse a
duplicate or inconsistent existing identity/account/membership rather than
repairing it implicitly.

### Transaction sequence

1. Read and validate the production target, approved operator identity,
   tenant/legal-entity/station IDs, and requested release-only grant scope.
   Confirm active status and all tenant-aware relationships. Do not print the
   email, identifiers, password, hash, database URL, or secret.
2. Check the exact email and all relevant identity/account/membership rows.
   Refuse if the email is owned by another identity, if a partial credential
   state exists, if the identity is already assigned to another tenant, or if
   any existing role/grant conflicts with the requested least-privilege scope.
3. Read the required permission definitions and refuse if any is missing.
4. Generate a UUID in process memory, hash the hidden password with Better
   Auth's official helper, and insert exactly one `auth.user` plus exactly one
   email/password `auth.account` row.
5. Insert exactly one `ACTIVE` `app.memberships` row for the approved tenant.
6. Insert exactly the explicit 12-permission read-only grant plan recorded in
   `first-user-provisioning-review.md`, with a short explicit expiry chosen by
   the release owner. Do not insert `provider.view`, a role assignment, or a
   wildcard grant unless a separately approved change updates the review.
7. Append the signed audit evidence. If a supported tenant-scoped audit row
   cannot be written without weakening RLS or inventing a global audit
   contract, abort and roll back; do not silently continue.
8. Commit only after all invariant and row-count checks pass. The script must
   print only a redacted success/failure summary and never the password,
   password hash, connection string, session, cookie, or secrets.

The password must be read with hidden local terminal input (`read -s` or an
equivalent TTY reader), kept in process memory, and unset/cleared when the
process exits. It must never be a command-line argument, repository value,
shell-history value, log field, audit detail, or ChatGPT message.

## Code/deployment/DB impact

- Current production application code change: **NO**.
- Auth configuration change: **NO**.
- Public HTTP bootstrap endpoint: **NO**.
- Permanent signup page or public self-registration: **NO**.
- Deployment required: **NO**. The existing production build remains
  unchanged.
- Database writes required for actual provisioning: **YES**, but only through
  the reviewed local one-shot transaction described above. The current
  repository has no supported user-provisioning service, so a local-only script
  is required; it may be retained on this review branch but must never be
  pushed to production or deployed as an application feature.
- Canonical migration required: **NO**. Do not add a migration for one user or
  change the auth schema.

## Verification after approved execution

1. Confirm the one-shot result contains only redacted evidence and that the
   transaction created one intended user, one credential account, one active
   tenant membership, the twelve intended read-only grants, and one signed
   audit event. Check that no session or TOTP row was created by the script.
2. Open `https://fuel.shandahr.com/login` in the approved browser and sign in
   normally. Do not construct a cookie or copy a session token from the
   database. Better Auth must issue the normal secure session cookie.
3. If the approved operator role requires strong authentication, enroll and
   verify TOTP through the existing authenticated MFA setup flow. Never seed a
   TOTP secret manually.
4. Export/inject the resulting session cookie only through the approved secure
   operator mechanism. Keep it hidden from shell history, logs, chat, and
   evidence. The repository's smoke harness reads
   `READONLY_SMOKE_SESSION_COOKIE` from the environment.
5. Run the existing read-only harness with the approved target IDs and
   production confirmation, for example:

   ```sh
   APP_ENV=production pnpm smoke:production-readonly -- \
     --environment production \
     --base-url https://fuel.shandahr.com \
     --tenant-a-id <approved-tenant-uuid> \
     --station-a-id <approved-station-uuid> \
     --confirm-readonly-production
   ```

   The harness permits only GET/HEAD and checks health, readiness, and the
   authenticated operations overview. Add approved Tenant B/station IDs only
   when cross-tenant denial is in scope.

6. Verify the redacted evidence reports HTTP 200 for Tenant A access and, if
   configured, HTTP 403/404 for Tenant B denial. Do not record response bodies,
   business data, cookies, or authorization headers.
7. Confirm no POST/financial/write-capable route was called and that the audit
   and application logs contain no password, hash, cookie, token, or secret.
8. After the short verification window, confirm the temporary grants are
   expired or explicitly revoked. A later long-lived operator role requires a
   separate authorization decision and must not be inferred from this plan.

## Rollback/removal plan

- Before commit: any failed preflight, invariant check, audit append, or
  row-count check rolls back the entire transaction. Do not retry blindly
  after an ambiguous connection failure; perform a read-only state check.
- After commit but before use: use the approved local administrative removal
  procedure to revoke the exact operation-scoped temporary grants and disable the membership;
  preserve the append-only audit evidence. Revoke any Better Auth sessions
  through the normal Better Auth server API where possible. If a controlled
  direct session revocation is ever required, it must be separately approved
  and verified; never delete or rewrite unrelated sessions.
- If the account acquired business history, disable the membership and
  account rather than deleting identity/auth rows. Deletion is not a normal
  correction path and could break audit/foreign-key history.
- Do not roll back by changing `disableSignUp`, deleting the auth schema,
  deleting all sessions, restoring the retired staging route, or reverting a
  canonical migration.

## Security risks and mitigations

| Risk                                                    | Mitigation                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Direct DB writes bypass an application command boundary | Keep the script local, one-shot, reviewed, explicit-targeted, transactional, and never expose it over HTTP.                          |
| Wrong tenant or station receives access                 | Require exact approved IDs; validate active hierarchy and composite references; use only station-scoped grants.                      |
| Duplicate/partial Better Auth records                   | Refuse duplicates and inconsistent states; enforce unique/FK constraints; verify row counts atomically.                              |
| Password/hash/session leakage                           | Hidden TTY input, process memory only, no command-line secret, no logging, no session creation, no secret-bearing evidence.          |
| Password hashing drift                                  | Use the pinned Better Auth `1.7.5` official crypto helper and verify locally before any production write.                            |
| Excess privilege                                        | Twelve explicit read-only permission codes only, short expiry, no OWNER/ADMINISTRATOR role, no tenant-wide wildcard grant.           |
| Audit bypass                                            | Append a signed event where the current tenant-scoped audit contract supports it; roll back if required evidence cannot be produced. |
| MFA/security weakening                                  | Leave `getAuth()` unchanged; use normal login and the existing MFA enrollment/verification flow.                                     |
| Production write outside scope                          | Explicit production confirmation, preflight, no public endpoint, no deploy, and only the one transaction.                            |

## What not to do

- Do not enable `disableSignUp: false`, add a signup page, or relax
  `trustedOrigins`.
- Do not create a public or temporary HTTP bootstrap endpoint.
- Do not restore or adapt the retired staging bootstrap command, synthetic
  IDs, staging email domain, or staging grants for production.
- Do not insert an auth user without its Better Auth credential account and
  matching active tenant membership.
- Do not hand-hash passwords, store plaintext credentials, request a password
  in ChatGPT, or pass a password/cookie/token on a command line.
- Do not hand-insert sessions, cookies, TOTP secrets, backup codes, or MFA
  assurance fields.
- Do not assign OWNER/ADMINISTRATOR, a tenant-wide role, or a wildcard grant
  merely because this is the first user.
- Do not invent tenant, legal-entity, station, role, or business master data.
- Do not use the app runtime as a general privileged bypass, disable RLS, use
  `BYPASSRLS`, weaken database roles, or modify canonical migrations.
- Do not run the read-only harness with a missing/printed cookie, and do not
  invoke POST, financial, migration, storage-write, email, or provider routes.
- Do not push or deploy the local operator script as a production application
  feature, and never commit credential material.

## Current blocker for execution

The plan is ready, but actual provisioning is not authorized or executable
from this preparation task. Execution still needs the release owner to supply
the approved operator identity, exact existing tenant/legal-entity/station
IDs, the intended permission duration (or a separately approved long-lived
role), and an approved direct database/operator credential. It also needs a
non-superuser/NOBYPASSRLS `first_user_provisioner` role and a safe synthetic
PostgreSQL test database. These are execution prerequisites, not a reason to
change production auth or create a public signup path.
