# Clerk-only authentication cutover

## Development procedure (2026-10-18)

Employees reach manual activation through **First time? Activate your account**
on the login page. New codes are formatted `7K3M-9R2X` (not a real code).
Typing lower case or omitting the hyphen is accepted. Codes are one-time and
expire in 72 hours; legacy long codes keep their original validity. Activation
permanently invalidates a code after five incorrect attempts. The employee must
ask their manager to generate a replacement; waiting does not restore it.
A replacement resets the failure count and gets a fresh 72-hour expiry.
A separate twenty-attempt limit per client per fifteen minutes still applies.
Do not share codes publicly or include them in logs. Generate a new activation
through the staff-management flow if a code is lost or expires.

This development procedure supersedes production/archive instructions below.
Do not use it to migrate an existing production database.

Drizzle now loads `.env.local` before `.env`, preserving shell-injected values.
Set `DATABASE_DIRECT_URL` to the administrator's non-pooled development connection
and run `pnpm db:migrate` after bootstrapping the repository's database roles.
Missing database configuration fails explicitly rather than targeting localhost.

The expected sequence is 0000–0030 (31 journal entries). Migration 0030 moves
`auth.user` to `app.users` with its UUIDs/foreign keys intact, updates SQL functions
and removes `auth.account`, `auth.session`, `auth.verification`, `auth.two_factor`,
non-Clerk mappings/assurance and the unused local MFA flag. It does not reset
financial or operational tables and does not archive development credentials.

The dedicated hard-coded production Owner script has been deleted. To seed one
existing Clerk development user, set the intended company and user privately:

```dotenv
APP_ENV=local
SEED_CLERK_USER_ID=user_your_existing_development_user
SEED_TENANT_SLUG=your-company-slug
SEED_TENANT_NAME=Your Company Name
```

Configure the app's Clerk test secret (`sk_test_`) and audit-signing credentials,
and verify the Clerk user's primary email if one is present. Username-only
accounts require no email; their internal email remains NULL (never invented).
Preview and explicitly apply:

```sh
pnpm db:seed
pnpm db:seed --apply
```

Preview only reads the Clerk user. Apply atomically creates/reuses the company,
internal user, Clerk mapping, Owner membership, role assignment and signed audit
event. Re-running is idempotent; conflicting mappings and inactive memberships
fail rather than being overwritten. No password is stored locally and no stations
or financial balances are invented. The seed refuses staging/production mode.

Review the migration and local test evidence before applying it to Neon dev.

## Historical production planning notes

This runbook supersedes provider-selection and Better Auth credential steps in
older release documents. Historical evidence remains historical.

## Prepare

1. Use a Clerk test instance for staging and a separate live instance for production.
2. Configure the login identifiers used by staff (including usernames/staff numbers),
   invitation-only access, password recovery, and the approved login MFA policy.
3. Set `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` privately in each
   environment. Remove `AUTH_PROVIDER` and `BETTER_AUTH_SECRET`; neither selects or
   configures authentication anymore. Keep audit-signing keys separate.
4. For CI, set secret `CLERK_TEST_SECRET_KEY` and variable
   `CLERK_TEST_PUBLISHABLE_KEY` to the dedicated test instance. Authenticated
   browser tests require provisioned test users; do not use production users.
5. Inventory existing internal users and their Clerk mappings. Preserve internal
   UUIDs. Link users through an authorized, explicit provisioning operation; do
   not auto-link by email on first login. Confirm at least one active Owner has a
   working Clerk identity before the maintenance window.

## Rehearse

Run typecheck, lint, unit tests, PostgreSQL integration tests, and the production
build. Apply the complete migration sequence to a fresh disposable database and
the new forward migration to a copy of the previous schema containing users,
memberships, and history. Compare UUIDs, foreign keys, mapping uniqueness, runtime
privileges, and tenant isolation before and after.

Exercise login, invitation acceptance, logout/draft purge, expired-session denial,
staff deactivation/revocation, station restrictions, and tenant/action-bound
privileged reverification. Confirm old application session cookies grant no access.

## Release

Take the normal independent backup and record the current deployment SHA and
migration state. Pause application writes for the schema transition. Apply the
reviewed forward migration using migration credentials, then release the matching
application artifact with Clerk configuration. Existing sessions must sign in
again using Clerk. Verify health/readiness and the rehearsed Owner/station flows
before reopening access to all stations.

## Recovery

Do not point an old Better Auth application artifact at the new schema. On failure,
keep writes paused and use a reviewed forward repair or restore the database and
matching application artifact together under the recovery procedure. Retained
legacy credentials are recovery material, never an alternate login path.
