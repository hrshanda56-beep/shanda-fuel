# Local operational workflow rehearsal

Use synthetic data only, on the dedicated PostgreSQL 18 test cluster. Nothing in
this procedure authorizes production/staging access, deployment or migrations.
The tested authentication provider is Better Auth. Keep `REQUIRE_LOGIN_MFA=true`;
Owner approval still requires a current password and authenticator verification.

## Prepare a fresh disposable database

The existing dedicated local cluster listens on `127.0.0.1:55438`, PostgreSQL 18.6,
UTC. Do not use another worktree's database or localhost:3000 server. Its local
runtime login has `NOSUPERUSER NOBYPASSRLS`; canonical bootstrap/migrations own ACLs.
A newly initialized cluster needs the normal reviewed local runtime login setup;
the seed script does not grant roles or privileges.

From this candidate worktree, using the PostgreSQL 18 binaries on PATH:

```sh
createdb -h 127.0.0.1 -p 55438 -U postgres shanda_owner_rehearsal
psql -h 127.0.0.1 -p 55438 -U postgres -d shanda_owner_rehearsal \
  -v ON_ERROR_STOP=1 -f ops/db/bootstrap.sql \
  -f scripts/db/bootstrap-first-user-provisioner.sql
DATABASE_DIRECT_URL=postgresql://postgres@127.0.0.1:55438/shanda_owner_rehearsal pnpm db:migrate:test
APP_ENV=test DATABASE_DIRECT_URL=postgresql://postgres@127.0.0.1:55438/shanda_owner_rehearsal \
  pnpm exec tsx scripts/seed-owner-workflow-local.ts
```

The seed refuses non-loopback destinations, non-`shanda_owner_*` database names,
non-test environments, non-PostgreSQL-18 servers, missing canonical migrations,
and an existing fixture tenant. It shares the browser test's synthetic fixture:
two nozzle/meter installations, two scoped Attendants, one Supervisor, one
independent tenant Owner, active diesel price **1.500000**, opening **3000.000 L**
and **3000.0000 USD** cost. Manual seed removes fixture sessions; sign in normally.
The historical business date is **23 September 2026**; the rehearsal shift's
interval is set relative to database time. Use a fresh seed if rehearsing later.

## Start locally

```sh
APP_ENV=test AUTH_PROVIDER=BETTER_AUTH REQUIRE_LOGIN_MFA=true \
APP_URL=http://127.0.0.1:3102 \
BETTER_AUTH_SECRET=integration-only-better-auth-secret-32-bytes \
AUDIT_SIGNING_KEY_ID=integration-workflow-key AUDIT_SIGNING_KEY=integration-workflow-secret \
DATABASE_URL=postgresql://app_runtime@127.0.0.1:55438/shanda_owner_rehearsal \
  pnpm dev --hostname 127.0.0.1 --port 3102
```

These credentials and signing values are public synthetic local fixtures, never
release configuration. Only one Next development server can run from this
worktree at a time; stop the manual server before Playwright starts its port 3100
server. Preserve other worktrees and their servers.

## Rehearse

1. Open `http://127.0.0.1:3102/login`. Supervisor email:
   `a5e-supervisor@example.test`; password: `synthetic-e2e-owner-password`.
2. Open the Operations daily board for tenant
   `a5e00000-0000-4000-8000-000000000001`, station
   `a5e00000-0000-4000-8000-000000000021`, business day
   `a5e00000-0000-4000-8000-000000000121`. Select Close meters on shift
   `a5e00000-0000-4000-8000-000000000135` (the interval near seed time).
3. Choose a different responsible attendant for each nozzle. Enter opening
   **100000.000**, closing **100250.000** on both. Close meters. This invokes
   actual boundary, seal, close and complete commands.
4. Open that shift's figures. Tick both Attendants. Check carried pump figures.
   In Payments enter Cash **500.0000**, EcoCash **150.0000**, Card (POS)
   **100.0000**. Expenses are empty. Cash counted: **500.0000**.
5. Submit through the final confirmation. Expected sales and accounted sales:
   **750.0000**, sales/cash variance **0.0000**. Saves and refreshes use server
   evidence; blank extra payment rows are excluded.
6. Sign out. Sign in as `a5e-manager@example.test`, same synthetic password.
   Open the submitted reconciliation's review link. Send back requires a reason;
   the Supervisor can correct/resubmit. Approval requires the separate Owner.
7. Choose Approve production reconciliation. If this new Owner is not enrolled,
   follow Set up MFA, store the synthetic recovery codes safely, enroll the
   authenticator and verify it. Then verify current password plus the current
   authenticator code. Confirm **Approve these figures?**. Refresh: **Approved**.
8. Approval posts two **-250.000 L** sale movements and exact costing/revenue;
   subsequent ordinary draft writes are rejected. Do not alter data to skip an
   unavailable or failed step.

## Automated rehearsal

Use another fresh database bootstrapped/migrated as above, without manual seeding
(the suite seeds its own fixture). Export the same synthetic auth/audit variables,
`APP_URL=http://127.0.0.1:3100`, runtime `DATABASE_URL`, and admin
`DATABASE_FIXTURE_URL` for that disposable database, then run:

```sh
pnpm test:e2e tests/e2e/production-reconciliation.spec.ts --workers=1
```

The integrated scenario tests the actual sheet, dropdown selections, fixed
payments, correction/resubmission, password/TOTP, confirmation, persisted
approval, exact sale movements, cross-station denial and immutable approved data.
Authentication layout/login-challenge tests are separately available in
`tests/e2e/auth-entry.spec.ts` and `tests/e2e/login-mfa.spec.ts`; their mocked
provider responses are UI coverage, not proof of a deployed provider.
