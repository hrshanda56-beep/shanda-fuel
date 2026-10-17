# Clerk-only authentication cutover

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
