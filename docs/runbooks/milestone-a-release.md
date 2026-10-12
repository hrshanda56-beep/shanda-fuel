# Milestone A release runbook (production 0026 -> 0029)

Status: PREPARED, NOT EXECUTED. Reconciled 2026-10-12 for the exact RC base
`31e14e4ad8bdc49c1d9b6491e975589197a36b14`; the local release-engineering
follow-up is recorded in the final handoff commit. Nothing in this document
has been run against Neon production. Every production step is for a named
human owner; no agent runs it. This runbook records no secrets and must never
be extended with connection strings, tokens, cookies, or passwords.

Release lock: production is verified at migration `0026`; `0027`, `0028`, and
`0029` remain pending and must be applied exactly once, in that order, after
the pre-migration branch, logical backup, and production-branch rehearsal pass.
The candidate uses `AUTH_PROVIDER=BETTER_AUTH`; no Clerk, provider account,
station setup, opening balance, historical import, or placeholder financial
value is implied by this runbook.

Related: [`deployment.md`](deployment.md), [`backup-restore.md`](backup-restore.md),
[`production-configuration.md`](production-configuration.md),
[`production-readonly-smoke.md`](production-readonly-smoke.md),
[`../release-readiness.md`](../release-readiness.md).

Known documentation drift (fix when closing the release): `docs/CURRENT_STATUS.md`
and `docs/implementation-status.md` still say production is at `0024` with
`0025` deferred. The release owner states production is now verified at `0026`.
Re-verify with the SELECT in section 3.3 before treating either as true, and
update both status files with the evidence afterwards.

## 1. Vercel administration access (read-only diagnosis, 2026-10-12)

### 1.1 What was checked (all read-only; no env values pulled, nothing changed)

| Check | Result |
| --- | --- |
| `vercel whoami` | Authenticated as `hrshanda56-4445` (CLI 62.1.0, interactive login session, no `VERCEL_TOKEN` in the environment). |
| `vercel teams ls` | One team, `shanda-hr-s-projects` (`team_VMthg2WoTS6eeOP5BjRh3i8b`), plan **hobby**. |
| `vercel teams members ls` | `hrshanda56-4445` is **OWNER**. Hobby has a single member. |
| `vercel projects ls -S shanda-hr-s-projects` | Lists `shanda-fuel` (prod, `fuel.shandahr.com`), `shanda-fuel-staging`, `shanda-fuel-owner-demo`, `shanda-fuel-recovery-20261001-182723z`, plus unrelated `triumph-energy`, `shanda-hr`. |
| `vercel project inspect shanda-fuel -S ...` | Works (`prj_XnPOpr7OP4fEne29nQqyENRCQkvf`). |
| `vercel env ls production --project shanda-fuel -S ...` (names only) | Works. 15 names present (see 1.3). |
| `vercel ls shanda-fuel -S ...` | Works; latest deployments are Preview. |
| Project link | The worktree has no `.vercel/`. The main checkout's `.vercel/project.json` links to **`shanda-fuel-staging`**, not production. |
| Neon CLI | `neon me` works as `hrshanda56@gmail.com`; org `Shanda-Fuel` (`org-morning-art-28987930`) lists `shanda-fuel-production` (`plain-paper-48449309`), `shanda-fuel-staging`, `shanda-fuel-owner-demo`. |

### 1.2 Diagnosis

The CLI is **not** blocked: the logged-in identity is the team OWNER and
read-only project, env-name, deployment, and member calls succeed. The
blockers are therefore not role or token-scope problems on this machine. What
actually stands in the way of "administration access":

1. **Wrong or missing project link.** Commands run from the repo root act on
   `shanda-fuel-staging` (main checkout link) or fail with "codebase isn't
   linked" (this worktree). The CLI here also rejects `--project` on
   `vercel ls` and takes the project as a positional argument; `env ls`
   accepts `--project`. Operators must pass `-S shanda-hr-s-projects` and the
   project explicitly, or run `vercel link --yes --team
   team_VMthg2WoTS6eeOP5BjRh3i8b --project shanda-fuel` in a dedicated
   production checkout. Never reuse the staging-linked checkout for production.
2. **No non-interactive credential.** No `VERCEL_TOKEN` exists, so scripted or
   agent sessions depend on the owner's interactive login. A scoped token is
   needed if an agent/CI is to perform any Vercel step.
3. **Hobby plan limits.** A hobby team has one member and no team role model,
   so there is no way to grant a second person Admin/Developer/Billing or a
   least-privilege role, and no team-level audit log or SSO. Delegated admin
   (accountant, second engineer, break-glass) requires upgrading to Pro. This
   is the real gap for "administration access" beyond the single owner.
4. **Production env is incomplete for the current code (config gate, not
   access).** `vercel env ls production` shows only: `REQUIRE_LOGIN_MFA`,
   `REQUIRE_PRIVILEGED_STEP_UP` (both type Config), `R2_*` (primary and
   recovery, 6), `AUDIT_SIGNING_KEY(_ID)`, `BETTER_AUTH_SECRET`, `DATABASE_URL`,
   `APP_URL`, `APP_ENV`. It does **not** list `AUTH_PROVIDER`. In
   `src/platform/config/env.ts` (`getServerEnv`) a production build with
   `APP_ENV=production` and `AUTH_PROVIDER` undefined throws
   `AUTH_PROVIDER must be explicitly configured in deployed environments`.
   Also absent: `CRON_SECRET`, `RESEND_*`, Clerk keys (needed only if
   `AUTH_PROVIDER=CLERK`). If the candidate is promoted without
   `AUTH_PROVIDER=BETTER_AUTH`, the deployment will fail at runtime. This must
   be set by the owner before promotion (see 1.4). Re-run
   `vercel env ls production` to confirm; the listing is as of this diagnosis
   and the Config-type values were deliberately not decoded.

### 1.3 Owner actions to unblock Vercel administration

| # | Owner action | Why |
| --- | --- | --- |
| V1 | Decide plan: stay on Hobby (single-owner operations, documented) or upgrade `shanda-hr-s-projects` to Pro to enable additional members and roles. | Hobby cannot grant any role to anyone else. |
| V2 | If Pro: invite named people with the least role needed (Developer for deploy/env-read; Member plus project-level access for read-only; Billing separately). Keep exactly one OWNER plus a documented break-glass. | Delegation and audit. |
| V3 | If an agent or CI must act: create a **team-scoped, expiring Vercel access token** from the owner account (Account Settings -> Tokens, scope `shanda-hr-s-projects`, expiry <= 7 days), hand it over via the secret manager or process environment only, and revoke after the release. Never paste it in chat, argv, or evidence. | No non-interactive credential exists today. |
| V4 | Link a dedicated production checkout: `vercel link --yes --team team_VMthg2WoTS6eeOP5BjRh3i8b --project shanda-fuel` (project id `prj_XnPOpr7OP4fEne29nQqyENRCQkvf`). | The existing link targets staging. |
| V5 | Add `AUTH_PROVIDER=BETTER_AUTH` to the **production** scope (`vercel env add AUTH_PROVIDER production`, value entered interactively), after confirming the intended provider. Do not set `CLERK` for Milestone A unless the Clerk keys and rollout are separately approved. | Required by `getServerEnv`; see 1.2 item 4. |
| V6 | Confirm in the dashboard that `REQUIRE_LOGIN_MFA` and `REQUIRE_PRIVILEGED_STEP_UP` have the intended production value (see section 5.1). Their values are Config-type and were not decoded here. | Decides which MFA smoke path applies. |

Agents must still not run `vercel env pull` against production, `vercel env
add/rm`, deploys, or promotes. The commands above are for the owner.

### 1.4 Safe read-only verification commands for the owner/operator

```sh
vercel whoami
vercel teams members ls
vercel env ls production --project shanda-fuel -S shanda-hr-s-projects   # names only
vercel ls shanda-fuel -S shanda-hr-s-projects
vercel project inspect shanda-fuel -S shanda-hr-s-projects
```

### 1.5 Environment verification matrix (owner/operator; names first, values never printed)

Run the commands in 1.4 from a dedicated checkout linked to the production
project. The `env ls` result verifies names and target scope only; verify secret
values in the Vercel dashboard or secret manager without pulling them into a
worktree, shell history, logs, or chat.

| Classification | Production value to verify | Evidence / rule |
| --- | --- | --- |
| Required | `APP_ENV=production`, `APP_URL=https://...`, `AUTH_PROVIDER=BETTER_AUTH` | The first two must be valid for the production hostname; `AUTH_PROVIDER` is mandatory for deployed builds. |
| Required secret | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `AUDIT_SIGNING_KEY_ID`, `AUDIT_SIGNING_KEY` | Runtime database URL and signing/auth secrets must be present; record only names and secret-manager references. |
| Required security | `REQUIRE_PRIVILEGED_STEP_UP=true`; owner decision for `REQUIRE_LOGIN_MFA` | Step-up is fail-closed by the application. MFA must be explicitly confirmed; its Config-type value was not decoded by the read-only preflight. |
| Conditional | `R2_*`, `RESEND_*`, `CRON_SECRET` | Required only if the approved release enables private object storage, invitation email delivery, or scheduled jobs; verify from the intended production operating procedure, not by assumption. |
| Must not be runtime | `DATABASE_DIRECT_URL` and disposable/test secrets | Direct migration credentials stay with the migration operator and are never placed in the deployed runtime. |
| Not required for this milestone | Clerk credentials | Do not add or select Clerk keys while the candidate is `BETTER_AUTH`; that is a separate approved rollout. |

Minimum verification is: `AUTH_PROVIDER` appears in the production name list;
the owner confirms the three required security decisions above without
revealing values; and the deployed candidate's `/api/health` and
`/api/readiness` checks pass after the approved deployment. Missing names or
an unconfirmed assumption is a BLOCKED release, not a reason to guess.

## 2. Verified backup and restore procedure (Neon production)

Production project: `shanda-fuel-production` (`plain-paper-48449309`), org
`org-morning-art-28987930`, region `aws-eu-central-1`. Branches observed
read-only on 2026-10-12: `main` (default, `br-morning-dust-b270y3ry`),
`production-baseline-20261004t043350z`,
`staff-invite-0026-validation-20261009`,
`staff-invite-0026-refresh-validation-20261009`.

Existing convention to reuse: `docs/runbooks/backup-restore.md` (RPO <= 15 min,
RTO <= 4 h as planning goals, never restore over production), the staging
rehearsal evidence in `recovery-evidence/` (main checkout, untracked; the
`timed-staging-recovery-rto-20261003131522.json` run recorded RTO 105 s and
requested-checkpoint RPO 0 s using a Neon recovery branch plus an isolated
Vercel deployment), and branch names of the form
`<purpose>-<UTC yyyymmddThhmmssZ>`. Neon PITR depth depends on the plan's
history window; the owner must record it (step B1). Note the staging drill
could not read a provider parent timestamp, so RPO evidence there was
"requested checkpoint", not provider-attested.

### 2.1 Pre-migration backup (owner executes; all names UTC)

Set `TS=$(date -u +%Y%m%dT%H%M%SZ)` once and reuse it.

| Step | Action | Evidence to record |
| --- | --- | --- |
| B1 | Neon console -> project -> Settings -> Storage/History: record the **restore window (history retention)** and plan. If shorter than 24 h, extend it for the release window or rely on branch + logical dump below. | Retention value, oldest restorable time. |
| B2 | Freeze writes if practical: announce a window and ensure no business day is mid-close. Record the exact checkpoint time `CP` (UTC, to the second) immediately before step B3. | `CP`. |
| B3 | Create the **pre-migration branch** from production `main` at `CP`: `neon branches create --project-id plain-paper-48449309 --name pre-0027-$TS --parent main` (or console: Branches -> Create, parent `main`, "Current data"). Branch is copy-on-write, takes seconds, and is the fastest rollback point. | Branch name, id (`br-...`), `createdAt`. |
| B4 | Set branch **expiry** of 14 days (console branch settings / `--expires-at`), or leave non-expiring until the release is signed off, then delete per section 2.4. Do not delete before sign-off. | Expiry or "kept until sign-off". |
| B5 | Independent logical backup (protects against Neon-side loss). From an approved client whose major version matches the server major (the production server major must be confirmed with `SHOW server_version`; staging was 18.6 with the `postgres:18` image, CI uses 16): `pg_dump --format=custom --no-owner --file pre-0027-$TS.dump` using libpq env (`PGHOST/PGUSER/PGDATABASE/PGPASSWORD` or a service file), never a URL in argv. Compute `shasum -a 256`, store encrypted outside the runtime bucket, and record size/checksum/retention. Existing staging-only helper: `scripts/db/create-staging-logical-backup.sh` (rejects production by design; do not run it against production). | File name, size, sha256, storage object/version, operator. |
| B6 | Capture **baseline counts** with the read-only block in 2.2 and save the output with the evidence. | Pre-migration count table. |

### 2.2 Baseline and post-restore verification SQL (read-only)

Run through the Neon SQL Editor or `psql` as a role that can see the tenant
(tables are `FORCE ROW LEVEL SECURITY`; set the tenant as in section 3.1 or use
the owner path). Every statement is a SELECT inside a READ ONLY transaction.

```sql
BEGIN READ ONLY;
-- migration level and ordering
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 6;
SELECT count(*) AS migrations_applied FROM drizzle.__drizzle_migrations;
-- row counts that must match before/after (restore) or stay equal (migration)
SELECT 'tenants' AS t, count(*) FROM app.tenants
UNION ALL SELECT 'memberships', count(*) FROM app.memberships
UNION ALL SELECT 'membership_role_assignments', count(*) FROM app.membership_role_assignments
UNION ALL SELECT 'staff_invitations', count(*) FROM app.staff_invitations
UNION ALL SELECT 'auth_user', count(*) FROM auth."user"
UNION ALL SELECT 'stations', count(*) FROM app.stations
UNION ALL SELECT 'security_events', count(*) FROM platform.security_events;
-- schema health
SELECT count(*) AS app_tables,
       count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity) AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind = 'r';
COMMIT;
```

`platform.security_events` is the audit-style table found in the migrations;
if an additional audit table exists in the deployed schema, add its count too
and do not skip the audit counts.
The last block must show `rls_forced = app_tables` (67 at 0026; 70 after 0029
because three tables are added).

### 2.3 Restore drill and real-incident restore

Never restore over production. To verify a restore (drill now, or incident):

1. Create a recovery branch from the pre-migration branch (or from `main` at a
   chosen timestamp via PITR): `neon branches create --project-id
   plain-paper-48449309 --name recovery-$TS --parent pre-0027-<TS>` (or `--parent
   main --parent-timestamp <ISO-UTC>` for PITR). Keep it with a short expiry.
2. Run section 2.2 against the branch. Pass criteria: migration table matches
   the checkpoint level (row count and top ids), every count equals the saved
   baseline (PITR to exactly `CP`) or is <= baseline with the gap explained,
   RLS parity holds, and the `drizzle` latest hash equals the expected file hash
   (section 3).
3. Optional application proof: a throwaway Vercel Preview/recovery project with
   `DATABASE_URL` pointing at the recovery branch (as in
   `recovery-evidence/` runs and `staging-recovery-rehearsal.md`); require
   `/api/health` 200 and `/api/readiness` 200 with database `ok`, then the
   read-only smoke (`production-readonly-smoke.md`). Invoke no write route.
4. To cut over in a true incident: repoint production `DATABASE_URL` to the
   recovery branch only under the incident owner's approval
   (`incident-response.md`), keeping the failed branch for forensics.
5. Record RTO as incident/drill start -> readiness 200 and RPO as the
   difference to the last committed transaction. Use the evidence JSON shape of
   `recovery-evidence/timed-staging-recovery-rto-*.json` with a `sha256` side
   file. Do not claim an SLA from a single drill.

### 2.4 Retention and cleanup

- Pre-migration branch and logical dump: keep until the release is signed off
  plus 7 days, then delete the branch with owner approval and record who
  approved. Keep the dump per the owner/accountant retention policy.
- The two `staff-invite-0026-*` validation branches and
  `production-baseline-20261004t043350z` are older; the owner should decide
  keep/delete explicitly and record it. They contain production data and
  should not live indefinitely.

## 3. Migration execution: 0027 -> 0028 -> 0029

Source of truth: `src/platform/db/migrations/` and `meta/_journal.json` (entries
27-29). SHA-256 of the files at the exact RC base `31e14e4`
(drizzle records the content hash, so
these must match what is recorded afterwards):

| Migration | SHA-256 |
| --- | --- |
| 0026_staff_invite_onboarding (already applied) | `22f56a2cdd441a77a124e421e9c4a57b186bd1e773ee70b1897e5235f992bb83` |
| 0027_clerk_staff_number_auth | `b832b8a5501de4e5ccc1baf4950bac9a00575f9fab289cd915ab1a31be8324de` |
| 0028_clerk_target_identity_revocation | `e840326318c53e5a17198b3fb3122d69eef1d51321afc6f13725e89f7bf4cf0a` |
| 0029_staff_number_registry_rls | `3530bb5dd38d46f8c1c74e8688f70f3634e8368ff877cd20b2014cd082a36a84` |

Recompute with `shasum -a 256` on the release commit before running; stop on
any mismatch.

### 3.0 Local throwaway dry run (done, 2026-10-12)

A disposable local PostgreSQL 16.15 cluster (CI uses `postgres:16`; production
major unverified) was initialised outside the repo, bootstrapped with
`scripts/db/bootstrap-test.sh` (roles: `migration_owner`, `app_runtime`,
`job_runtime`, `diagnostics_readonly`, `first_user_provisioner`), and the full
journal `0000` -> `0029` was applied in order, each file in its own transaction,
as superuser `postgres`. Result: all 30 files applied with zero errors, then the
cluster was stopped and deleted. Observed post-state:

- New tables `app.auth_identities`, `app.staff_number_registry`,
  `app.auth_session_assurance`, and `app.staff_invitations` all owned by
  `migration_owner`; RLS enabled and forced on the three new tables.
- Policies: `auth_identities` has `_current_actor`, `_bind`,
  `_target_provider_lookup` (0028), `_security_definer` (0029);
  `staff_number_registry` has `_security_definer` (0029);
  `auth_session_assurance` has `_current_actor`.
- Eight SECURITY DEFINER functions owned by `migration_owner`; `EXECUTE`
  granted to `app_runtime`, not to PUBLIC; `app_runtime` has no direct SELECT
  on `app.auth_identities`.
- `auth."user".email` nullable.
- Re-running 0027, 0028, or 0029 against an already-migrated database fails
  immediately (`relation ... already exists`, `policy ... already exists`),
  confirming they are not idempotent and must run exactly once (a failed
  transaction leaves nothing behind).

Limits of the dry run: empty database (backfill and lock timing on real data
not exercised), superuser applier (production applier is a restricted path, see
3.2 pre-check P6), PostgreSQL 16 not 18. Repeat the rehearsal on a Neon branch
of production (section 3.6) before the real run; that is the only realistic
data test.

### 3.1 Read-only production configuration script (copy of the prepared script)

Run in the Neon SQL Editor against production, never writing. Replace
`<TENANT_UUID>` once. Run before and after migration and keep both outputs.

```sql
-- SHANDA FUEL: READ-ONLY production configuration inspection (Neon SQL Editor)
-- Every statement is a SELECT. The transaction is declared READ ONLY, so the
-- database itself rejects any write. Run each block separately and paste results.
-- Tables are FORCE ROW LEVEL SECURITY: if a block returns 0 rows unexpectedly,
-- run STEP 0 first, copy the tenant id, and use the "with tenant" form below.

-- STEP 0: find the tenant (may return 0 rows under RLS; if so use the Neon
-- branch's owner/BYPASSRLS role, or ask me for the tenant id from prior notes).
BEGIN READ ONLY;
SELECT id, name, slug, status FROM app.tenants;
COMMIT;

-- STEP 1..N: run as ONE script. Replace <TENANT_UUID> once at the top.
BEGIN READ ONLY;
SELECT set_config('app.tenant_id', '<TENANT_UUID>', true);

-- 1. Legal entities and stations (expect 4 ACTIVE stations)
SELECT le.legal_name, le.status AS entity_status, s.code, s.name, s.timezone, s.status
FROM app.stations s JOIN app.legal_entities le ON le.id = s.legal_entity_id
ORDER BY s.code;

-- 2. Fuel products
SELECT code, name, status FROM app.products ORDER BY code;

-- 3. Tanks per station
SELECT s.code AS station, t.code AS tank, p.code AS product, t.capacity_litres,
       t.reorder_level_litres, t.acceptable_variance_litres, t.status,
       (SELECT count(*) FROM app.tank_calibration_points c WHERE c.tank_id = t.id) AS calibration_points
FROM app.tanks t
JOIN app.stations s ON s.id = t.station_id
JOIN app.products p ON p.id = t.product_id
ORDER BY s.code, t.code;

-- 4. Pumps and nozzles per station
SELECT s.code AS station, pu.number AS pump, pu.name, pu.status AS pump_status,
       n.number AS nozzle, p.code AS product, n.status AS nozzle_status
FROM app.pumps pu
JOIN app.stations s ON s.id = pu.station_id
LEFT JOIN app.nozzles n ON n.pump_id = pu.id
LEFT JOIN app.products p ON p.id = n.product_id
ORDER BY s.code, pu.number, n.number;

-- 5. Shift templates
SELECT s.code AS station, st.code, st.name, st.duration_minutes, st.active
FROM app.shift_templates st JOIN app.stations s ON s.id = st.station_id
ORDER BY s.code, st.code;

-- 6. Selling prices (state shows pending vs approved)
SELECT s.code AS station, p.code AS product, sp.unit_price, sp.currency, sp.state,
       sp.effective_from, sp.effective_to
FROM app.selling_prices sp
JOIN app.stations s ON s.id = sp.station_id
JOIN app.products p ON p.id = sp.product_id
ORDER BY s.code, p.code, sp.effective_from DESC;

-- 7. Payment providers and provider accounts
SELECT pp.code, pp.name, pp.provider_type, pp.status AS provider_status,
       pa.display_name, pa.account_reference, pa.currency, pa.status AS account_status,
       s.code AS station
FROM app.payment_providers pp
LEFT JOIN app.provider_accounts pa ON pa.provider_id = pp.id
LEFT JOIN app.stations s ON s.id = pa.station_id
ORDER BY pp.code, s.code;

-- 8. Counts of master data and activity (to see what already exists)
SELECT 'suppliers' AS what, count(*) FROM app.suppliers
UNION ALL SELECT 'customers', count(*) FROM app.customers
UNION ALL SELECT 'customer_accounts', count(*) FROM app.customer_accounts
UNION ALL SELECT 'business_days', count(*) FROM app.station_business_days
UNION ALL SELECT 'inventory_movements', count(*) FROM app.inventory_movements
UNION ALL SELECT 'fuel_deliveries', count(*) FROM app.fuel_deliveries;

-- 9. Applied migrations (confirm production level)
SELECT * FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;

COMMIT;
```

The script reports configuration only. Anything it shows as missing (tanks,
prices, calibration, provider accounts, opening positions) is onboarding data
for the client and must not be invented to pass a check.

### 3.2 Per-migration summary

#### 0027_clerk_staff_number_auth

- Changes: `auth."user".email` DROP NOT NULL; new tables
  `app.auth_identities`, `app.staff_number_registry`,
  `app.auth_session_assurance` with constraints, indexes, FORCE RLS and
  policies; `app.staff_invitations` gains `delivery_method` (NOT NULL DEFAULT
  `'EMAIL'`) and `staff_number_registry_id`, `invited_email` DROP NOT NULL,
  new CHECKs/FK, and the pending-email unique index is dropped and recreated
  as partial (`invited_email IS NOT NULL`); seven SECURITY DEFINER functions
  (identity/staff-number resolve, reserve, manual invitation resolve/accept);
  REVOKE from PUBLIC; ownership moved to `migration_owner`; `EXECUTE` granted
  to `app_runtime`; **backfill**: one `BETTER_AUTH` identity row per existing
  `auth."user"` (`ON CONFLICT DO NOTHING`).
- Locks and risk: ACCESS EXCLUSIVE briefly on `auth."user"` (DROP NOT NULL)
  and `app.staff_invitations` (ADD COLUMN with constant default is
  metadata-only on PG11+, new constraints validate against the existing
  `staff_invitations` rows, new FK checks, index drop/create). Tables are
  small (pilot), so expect sub-second locks. The backfill is one INSERT ...
  SELECT over `auth."user"` (tiny). Risk: ownership statements require the
  applying role to be able to `ALTER ... OWNER TO migration_owner` (membership
  in that role, and currently owning the objects). If it cannot, the migration
  fails and rolls back.
- Data impact: additive. No existing row is deleted or rewritten except
  `staff_invitations` gaining default `EMAIL`. Existing sign-in keeps working:
  Better Auth identities are mapped 1:1 (`provider_user_id = id::text`).
- Idempotent: **no** (plain CREATE TABLE/ADD COLUMN/CREATE POLICY). Run once.
- Rollback: transactional, so a failed run leaves nothing. After success there
  is no down-migration (repository policy forbids inventing them). Roll back by
  restoring the pre-migration Neon branch (section 2) and redeploying the
  previous application image; the old app ignores the new tables and columns,
  except it cannot create emailless invitations. Forward-only fix is preferred.

#### 0028_clerk_target_identity_revocation

- Changes: one new SELECT policy `auth_identities_target_provider_lookup` and
  one SECURITY DEFINER function
  `app.resolve_provider_identity_for_membership(text, uuid, uuid)` (tenant
  OWNER/ADMINISTRATOR only, cannot target self, sets then clears
  transaction-local selector settings); REVOKE from PUBLIC; owner
  `migration_owner`; `EXECUTE` to `app_runtime`.
- Locks and risk: trivial (brief lock on `app.auth_identities` for the policy).
  Depends on 0027 objects, so it must follow 0027.
- Data impact: none. Idempotent: no. Rollback: restore the branch, or forward
  fix by `DROP POLICY`/`DROP FUNCTION` in a reviewed new migration.

#### 0029_staff_number_registry_rls

- Changes: two policies for role `migration_owner`
  (`auth_identities_security_definer`, `staff_number_registry_security_definer`)
  so the migration_owner-owned SECURITY DEFINER functions can read and write
  the FORCE-RLS tables. `app_runtime` still has no direct table privileges.
- Locks and risk: trivial. **Important**: without 0029, the 0027 functions are
  blocked by FORCE RLS, so 0027 or 0028 deployed alone leaves staff-number and
  Clerk-resolution paths non-functional. Apply 0027, 0028, 0029 together. The
  policies are scoped `TO migration_owner` with `current_user =
  'migration_owner'`, so they widen nothing for `app_runtime`.
- Data impact: none. Idempotent: no. Rollback: as above (`DROP POLICY`).

### 3.3 Pre-checks (all must pass; go/no-go inputs)

| ID | Check | Pass criterion |
| --- | --- | --- |
| P1 | Candidate commit SHA is on the PR/branch with required CI green (section 4.2) and the four SHA-256 values above match. | Exact match. |
| P2 | `SELECT count(*), max(id) FROM drizzle.__drizzle_migrations;` and top-5 rows | Exactly 27 rows (`0000`..`0026`), none of 0027-0029 present. If the count differs, stop and reconcile. |
| P3 | `SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='staff_invitations' AND column_name IN ('delivery_method','staff_number_registry_id');` and `SELECT to_regclass('app.auth_identities'), to_regclass('app.staff_number_registry'), to_regclass('app.auth_session_assurance');` | 0 rows / all NULL (objects not partially present). |
| P4 | `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('migration_owner','app_runtime','job_runtime','diagnostics_readonly','first_user_provisioner');` | All five exist; none superuser; none BYPASSRLS; `job_runtime` remains unbound per the security exception. |
| P5 | `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND xact_start < now() - interval '30 seconds';` | 0 long-running transactions (they would block the DDL). |
| P6 | Applier role can run the ownership DO blocks: confirm the direct migration connection used for 0021-0026 is the same path, and that `SELECT pg_has_role(current_user, 'migration_owner', 'MEMBER');` is true (or the connection is the owner/admin path that previously applied the `ALTER ... OWNER` statements of 0026). | true. |
| P7 | Pre-migration branch exists, dump checksum recorded, baseline counts saved (section 2.1). | Evidence present. |
| P8 | Auth/user baseline: `SELECT count(*) FROM auth."user";` and `SELECT count(*) FROM app.staff_invitations;` | Saved; expected post-migration `auth_identities` count equals `auth."user"` count. |
| P9 | Production `AUTH_PROVIDER` decided and set (V5) and `/api/health`, `/api/readiness` currently 200. | Both 200. |
| P10 | A rehearsal of 0027 -> 0029 succeeded on a Neon branch of production (section 3.6). | Success and post-checks pass. |

### 3.4 Exact command sequence (operator, production, in a quiet window)

Run from a clean checkout of the exact release commit on an approved operator
machine. The direct connection string is held in the process environment by the
secret manager only; it is never typed, echoed, or logged.

```sh
git rev-parse HEAD                                   # must equal the approved SHA
shasum -a 256 src/platform/db/migrations/002{7,8,9}_*.sql   # compare with section 3 table
pnpm install --frozen-lockfile
pnpm db:check                                        # metadata consistency, no DB needed
# DATABASE_DIRECT_URL must already be exported by the approved mechanism.
pnpm db:migrate                                      # drizzle-kit migrate; applies 0027, 0028, 0029
```

drizzle-kit runs all pending migrations from the journal in one pass; stop at
the first error and do not retry blindly. Then, if the repository's established
practice requires it (CI does this after migrating), confirm
`drizzle.__drizzle_migrations` and schema `drizzle` ownership matches the
convention used for 0021-0026 before changing anything; do not alter ownership
unless the earlier release evidence shows it was done.

### 3.5 Post-checks (read-only)

```sql
BEGIN READ ONLY;
SELECT count(*) AS migrations_applied, max(id) AS max_id FROM drizzle.__drizzle_migrations;  -- expect 30 rows (0000..0029)
SELECT n.nspname, c.relname, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relname IN
  ('auth_identities','staff_number_registry','auth_session_assurance','staff_invitations');
  -- expect owner migration_owner; rls and forced true for the first three
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('auth_identities','staff_number_registry','auth_session_assurance')
ORDER BY 1, 2;
  -- expect 4 on auth_identities, 1 on staff_number_registry, 1 on auth_session_assurance
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
       has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime_exec,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND p.proname IN (
  'resolve_auth_identity','resolve_provider_identity','reserve_staff_number',
  'resolve_staff_number_for_invitation','resolve_staff_number_for_user',
  'resolve_manual_staff_invitation','accept_manual_staff_invitation',
  'resolve_provider_identity_for_membership')
ORDER BY 1;
  -- expect 8 rows: owner migration_owner, prosecdef true, runtime_exec true, public_exec false
SELECT has_table_privilege('app_runtime', 'app.auth_identities', 'SELECT') AS runtime_direct_select;  -- expect false
SELECT (SELECT count(*) FROM app.auth_identities WHERE provider = 'BETTER_AUTH') AS identities,
       (SELECT count(*) FROM auth."user") AS users;                                                   -- expect equal
SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app' AND c.relkind='r') AS app_tables,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) AS rls_forced;
  -- expect equal (70 if 67 at 0026)
COMMIT;
```

Then re-run the baseline count block from 2.2 (all pre-existing counts
unchanged), the config script in 3.1 (identical to the pre-run output), and the
application checks: `/api/health` 200, `/api/readiness` 200 database `ok`,
then the section 5 smoke. Record hashes: for each of 0027-0029 the row in
`drizzle.__drizzle_migrations` must be present exactly once with the hash in
the table above.

### 3.6 Rehearsal on a production branch (recommended, owner executes)

Create `rehearse-0027-$TS` from `main` in Neon (branch-only, production data
copy-on-write, no effect on production), run the exact 3.4 sequence with the
branch's direct connection, run 3.5, then delete the branch. This exercises
real data, lock behaviour, and the applier's ownership privileges, which the
local dry run could not.

### 3.7 Go/no-go checklist (all YES required)

- [ ] Release commit/SHA approved; PR merged by a human; CI green (4.2).
- [ ] 0027/0028/0029 SHA-256 match section 3.
- [ ] P1-P10 pass; pre-migration branch and logical dump exist with evidence.
- [ ] Rehearsal on production branch passed (3.6).
- [ ] Owner/operator present; quiet window; rollback owner named.
- [ ] `AUTH_PROVIDER=BETTER_AUTH` set in production Vercel scope before promotion (V5).
- [ ] The application candidate was built to tolerate pre- and post-migration
      schema (see ordering below).
- [ ] Rollback decision rule written down: any post-check failure, or
      `/api/readiness` != 200 after 5 minutes, triggers a stop; schema is
      forward-fixed or the pre-migration branch is promoted via the incident
      process.

Ordering: migrate first, then deploy the application. The new schema is
additive and the previous release ignores it, so migrate-then-deploy has no
compatibility gap; deploy-then-migrate would run code against missing
functions. If the release is a Better Auth-only rollout (`AUTH_PROVIDER=BETTER_AUTH`)
the 0027-0029 objects are not exercised until staff-number features are used,
but they must still be applied before that code ships.

### 3.8 Backend work that may add 0030

Further backend work may add `0030`. The journal is owned by A0
(`src/platform/db/migrations/README.md`); feature work only proposes SQL. Rules:

1. Do not interleave: land and apply 0027-0029 first (they are final on
   `31e14e4`), then number the next migration `0030` strictly after them.
2. A new migration must not edit 0027-0029 (their hashes are recorded in
   production); corrections are a new forward migration.
3. If 0030 is ready before the Milestone A window closes, either (a) hold it
   to a second window with its own backup, rehearsal, and pre/post checks
   (preferred; keeps the blast radius to the reviewed three), or (b) append it
   to the same window only with the owner's explicit approval and a rehearsal
   of 0027-0030 together.
4. Update the journal `idx`/`when` ordering (`when` strictly greater than
   `1791816395000`), the README migration count, and the integration test
   pattern of `002x_*.test.ts`.

## 4. Release-candidate gate

### 4.1 Pre-flight gate (RC cut)

- Release branch/commit identified; working tree clean; no untracked
  evidence files committed by accident.
- Status and release-readiness docs updated with the true production migration
  level and this runbook linked (the stale 0024 text is corrected).
- Rollout runbook (`docs/runbooks/production-rollout-120.md`, main checkout,
  untracked) reconciled with this runbook or intentionally superseded.

### 4.2 Green CI (all jobs in `.github/workflows/ci.yml` on the RC SHA)

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate:test`,
first-user-provisioner assertion, `pnpm db:check`, `pnpm test:unit`,
`pnpm test:integration`, `pnpm build`, `pnpm test:e2e --workers=1`, dependency
audit, secret scan, Semgrep SAST, CodeQL, and the Runtime-role proof job
(production server with no direct migration credentials; dev-route and
navigation-fixture denial).

### 4.3 Evidence list to attach (metadata only, no secrets)

1. RC SHA, PR number, CI run URL with all jobs green.
2. Migration SHA-256 table (section 3) and `drizzle.__drizzle_migrations`
   before/after output.
3. Neon pre-migration branch name/id/time, retention, dump size/checksum/location.
4. Baseline vs post-migration count tables and the config script outputs.
5. Rehearsal result on the production branch.
6. Production `vercel env ls production` names list (no values) showing
   `AUTH_PROVIDER` present, plus the owner's statement of the
   `REQUIRE_LOGIN_MFA` value.
7. Deployment id/alias and `/api/health`, `/api/readiness` results.
8. Section 5 smoke results with timestamps and the operator.
9. Rollback decision record and sign-offs (owner; accountant where finance data
   is affected).
10. Updated `docs/CURRENT_STATUS.md` and `docs/release-readiness.md`.

## 5. Milestone A production smoke checklist

Principles: read-only unless the item says otherwise; use real production
accounts approved by the owner; never create fabricated stations, tanks,
prices, customers, or balances to make a check pass; record "NOT CONFIGURED"
as a legitimate outcome when onboarding data is genuinely missing.

### 5.1 Auth and MFA

`REQUIRE_LOGIN_MFA` (`src/platform/config/env.ts`, enforced through the Better
Auth two-factor plugin in `src/platform/auth/better-auth.ts`) decides the path.
Prior rollout notes expect it to be `true` in production; the Vercel listing
shows it as Config-type, so the owner must confirm the value (V6).

| ID | Check | Pass criteria |
| --- | --- | --- |
| A1 | Unauthenticated request to a protected page and a protected API | Redirect to sign-in / 401; no data. |
| A2 | OWNER sign-in with `REQUIRE_LOGIN_MFA=true` | After password, a TOTP/second-factor challenge is required; wrong code is rejected; correct code lands on the role home. |
| A2b | If the flag were `false` (only with owner sign-off) | Sign-in succeeds without a challenge, and privileged actions still require step-up when `REQUIRE_PRIVILEGED_STEP_UP=true`. Record the exception. |
| A3 | OWNER MFA enrollment present (verified earlier at the Stage 1 closeout) | Enrolled; no re-enrollment surprises. |
| A4 | Session expiry/sign-out | Sign-out clears the session; protected route redirects again. |
| A5 | No auth bootstrap/staging helper reachable | Dev and fixture routes return 404/denied (CI asserts the same; confirm once on the live alias). |

### 5.2 Role access (least privilege)

| ID | Check | Pass criteria |
| --- | --- | --- |
| R1 | Each role the owner has actually provisioned (OWNER, then any ADMINISTRATOR / station roles that exist) lands on its permission-driven home workspace | Each sees only navigation permitted for the role; no cross-station data. |
| R2 | Deep-link to a forbidden route as a lower role | 403/redirect, no content flash. |
| R3 | Tenant isolation: `production-readonly-smoke` Tenant A returns 200 on `/api/forecourt/operations/overview`; a second tenant context, if one exists, returns 403/404 | 200 for A; 403/404 only for B. Skip B when no second tenant exists; record "no second tenant". |
| R4 | After 0027-0029: staff-number invitation and deactivation flows | Create/resolve manual staff invitation works for OWNER/ADMINISTRATOR; deactivation resolves the Clerk target only for those roles and never for self (verify in staging unless Clerk is enabled in production; Milestone A with `AUTH_PROVIDER=BETTER_AUTH` only checks nothing regresses). |

### 5.3 Setup paths and unconfigured-station blocking

Run the config script (3.1) alongside this section.

| ID | Check | Pass criteria |
| --- | --- | --- |
| S1 | Setup / onboarding screens for station, tanks, pumps/nozzles, shift templates, prices, providers open and show the real current state | Each shows existing data or an explicit empty state with the next action; no spinner hang, no raw error. |
| S2 | A station missing tanks, calibration, prices, or shift templates cannot start a business day / record sales | The start command is blocked with a clear, specific reason naming the missing setup; no partial record is created. |
| S3 | A fully configured station (only if the owner confirms real configuration) can open the next-step flow | Reaches the first step without error; stop before any financial posting. Do not post a real or test sale in production to prove this. |
| S4 | No fabricated data | No demo tenant, "sample" station, placeholder balance, synthetic prices, or fake customers visible in production. Counts from 3.1 step 8 agree with owner-supplied data. |

### 5.4 Responsive core flows

At 320, 375, 768, 1280 px (browser dev tools is acceptable):

| ID | Check | Pass criteria |
| --- | --- | --- |
| U1 | Sign-in, MFA challenge, role home, overview, setup screens | No horizontal page scroll at 320 px; whole-row click targets and pointer cursor; no layout overflow; focus visible. |
| U2 | Keyboard and screen-reader sanity on sign-in and the primary navigation | Tab order logical; labels present (matches `tests/e2e/accessibility.spec.ts` intent). |
| U3 | Loading, empty, and error states | Each page renders a calm empty state or recoverable error; none show stack traces. |

### 5.5 Platform health

| ID | Check | Pass criteria |
| --- | --- | --- |
| H1 | `GET /api/health` | 200, application `ok`. |
| H2 | `GET /api/readiness` | 200, database `ok`. |
| H3 | `pnpm smoke:production-readonly` with `--environment production --confirm-readonly-production` (cookie via the secure environment only) | All checks PASS; evidence recorded. See `production-readonly-smoke.md`. |
| H4 | Vercel runtime logs for the first 30 minutes | No unhandled exception, no `AUTH_PROVIDER must be explicitly configured`, no RLS denial spikes. |
| H5 | Rate-limit and observability alerts | Alert routing still functional per `observability.md`; record any open launch exception. |

Final result: PASS only if every non-skipped item passes. Items skipped
because the client has not supplied data are recorded as "NOT CONFIGURED
(onboarding)" and do not by themselves fail the gate, but must be listed.
