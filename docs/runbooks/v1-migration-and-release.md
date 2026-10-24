# v1 migration runbook and release checklist (DRAFT, not executed)

**Written for:** the person who will run the production release (the owner or the operator they name).
**Status:** draft for review. Nothing in this file has been run. No production system was contacted.
Every production step below is performed by a human, with credentials entered at a hidden terminal
prompt. Follow it together with [`deployment.md`](deployment.md) and
[`production-configuration.md`](production-configuration.md); this file adds the v1 migration list and
the release record.

## 1. Ground rules

- Migrations are forward-only. There are no down-migrations. The rollback for a bad migration is a
  restore from the pre-migration backup (see [`backup-restore.md`](backup-restore.md)), not a reverse script.
- Migrations are applied through the restricted direct path (`DATABASE_DIRECT_URL`, acting as
  `migration_owner`), never from the browser, never on app start-up, never as `app_runtime`.
- Production migration state must be read from the production database itself. A successful web
  deployment says nothing about it.
- Do not put database URLs or passwords in chat, files, logs or command arguments.
- The app must not start with migration-owner credentials. `DATABASE_URL` is the pooled `app_runtime`
  connection.
- Nothing here is run until the owner says so for that step.

## 2. What the migrations do

Production's current migration state is **not known from the repository**. Older release notes say
production was at `0025` at one point; confirm by reading the migration table (step 4.2) before you
trust any row below. Rows already applied are skipped.

None of the migrations from `0025` onward drops a table, schema or column (checked by searching
the files). `0030` removes the old `auth.*` login tables after moving users to `app.users`, so it is the one to
read twice. The SHA-256 of each file is in section 6 so the file you run can be matched to the file
that was reviewed.

| No. | File | What it does (plain words) | Care |
| --- | --- | --- | --- |
| 0025 | customer_credit_station_scope | Lets customer credit be used at any station; new link table | Has its own preflight: [`customer-credit-0025-preflight.md`](customer-credit-0025-preflight.md). Locks 3 tables briefly |
| 0026 | staff_invite_onboarding | Staff invitations | |
| 0027 | clerk_staff_number_auth | Staff numbers for Clerk sign-in | Part of milestone A: see [`milestone-a-release.md`](milestone-a-release.md) |
| 0028 | clerk_target_identity_revocation | Revoking a sign-in identity | Milestone A |
| 0029 | staff_number_registry_rls | Row security on the staff-number list | Milestone A |
| 0030 | clerk_only_application_users | Moves users to `app.users`, removes old local-login tables | **Read first.** Do the Clerk cutover steps in [`clerk-only-cutover.md`](clerk-only-cutover.md) before it. Old sessions end |
| 0031 | manual_activation_attempt_limit | Locks an activation code after 5 wrong tries | |
| 0032 | custom_staff_numbers | Staff numbers can be chosen | |
| 0033 | finance_reconciliation_return | Finance can send a reconciliation back | |
| 0034 | navigation_context_snapshot | Remembers navigation context | |
| 0035 | expenses | Expenses | |
| 0036 | purchase_orders | Purchase orders | |
| 0037 | supplier_invoice_lines_and_policy | Supplier invoice lines and rules | |
| 0038 | supplier_document_reference_reuse | Stops the same supplier document being booked twice | |
| 0039 | expense_attachments | Receipts on expenses | |
| 0040 | recurring_cost_adjustments | Recurring costs and their adjustments | |
| 0041 | responsible_supervisor | One responsible supervisor per station | |
| 0042 | payment_customer_and_beneficiary | Customer on a payment; beneficiary on approved fuel | |
| 0043 | cash_handover_resolution | Cash handover short/over resolution | |
| 0044 | tank_calibration_versions | Versioned tank calibration charts | |
| 0045 | supplier_credit_limit | Supplier credit limit warning | |
| 0046 | alert_settings | Reminder thresholds (Settings > Reminders) | |
| 0047 | unified_expense_evidence | Expense evidence | |
| 0048 | unified_expense_corrections | Expense corrections | |
| 0049 | documents | Private file attachments (photo, PDF, DOCX) | Needs the R2 bucket configured before uploads work |

The journal in `src/platform/db/migrations/meta/_journal.json` lists 0000 to 0049 (50 entries) at the
head of this branch. Migration `0047` to `0049` were renumbered during consolidation; none had been
applied anywhere, so no environment holds the old numbers. If a staging database was ever migrated
from the old branch, rebuild it rather than patching it.

## 3. Before the release window

Tick each box and write who ticked it and when in the record (section 7).

1. [ ] The exact commit to release is chosen and recorded. It is a commit on `main` (after the
   integration branch merges), not a branch name.
2. [ ] Required GitHub checks are green on that commit. This needs the Clerk test secret and variable
   in GitHub so the `quality` and runtime-role jobs can run.
3. [ ] Unit, database-integration and tenant-isolation tests passed on that commit. Any suite that was
   skipped is listed as a skip, not a pass.
4. [ ] `pnpm db:check`, typecheck, lint, format check and production build are green.
5. [ ] The browser (Playwright) and accessibility suites ran against a real Clerk test instance and are
   green. If they have not run, that is a blocker to write down, not a pass.
6. [ ] A restore point exists and has been proven: a Neon branch or dump taken just before migration,
   with a note of how to restore it and who decides to.
7. [ ] Secrets are present in Vercel for production and are not in the repository: Clerk keys,
   `AUDIT_SIGNING_KEY_ID`, `AUDIT_SIGNING_KEY`, database URLs, Resend (only if alert email is enabled),
   R2 credentials and bucket, `CRON_SECRET` (only if a cron is enabled).
8. [ ] Production Clerk is the live instance, not the test one, and its allowed origin is
   `https://fuel.shandahr.com`.
9. [ ] A maintenance window is agreed. No one is entering sales, cash or customer payments during it.
10. [ ] Someone is named to approve a rollback and someone to run it.

## 4. The release, in order

Stop at the first step that does not give the expected result. Do not continue "to see what happens".

1. **Freeze.** Tell staff the system is closed for entries. Note the time.
2. **Read the production migration state.** Using the reviewed read-only path, record which migration
   rows exist and the count. Compare to the journal. The result decides where to start. Record it.
3. **Take the restore point.** Record its identifier (not a connection string).
4. **Check the files.** On the operator's machine, run `shasum -a 256` on each migration file you are
   about to apply and compare with section 6. Any mismatch means stop: the files are not the reviewed ones.
5. **Run the 0025 preflight** if 0025 is still to be applied.
6. **Apply migrations** with `pnpm db:migrate` from a clean checkout of the exact release commit,
   with `DATABASE_DIRECT_URL` entered through the hidden prompt of the reviewed operator flow. Apply in order.
   Never edit or re-order an applied migration.
7. **Verify the database.** Read the migration table again: the count and last tag must match the
   journal. Confirm RLS is still forced on the tables the migrations touched, that `app_runtime`
   still has no ownership, and that the runtime-role proof (the "Runtime-role proof" CI job logic) passes.
8. **Deploy the web app** at the recorded commit only after step 7 passes. Confirm Vercel shows that
   exact commit.
9. **First-user bootstrap** (only if production has no owner yet) follows the separate reviewed
   sequence in AGENTS.md section 7.3 and its own runbook: dry run, zero-write proof, explicit approval,
   a separately reviewed real run, credential cleanup. Do not combine it with this runbook.
10. **Smoke test as the real owner** on `https://fuel.shandahr.com` (not a preview URL):
    sign in; open the dashboard; open Daily Operations; open one report and download its CSV;
    open Cash; open Settings. Nothing should show a made-up number; empty areas say so.
11. **Reopen** to staff only after the smoke test passes. Record the time.
12. **Watch** logs and the alert channel for the first day.

## 5. Rollback rules

- **App only broken, database fine:** redeploy the previous Vercel deployment. The older app may not
  understand new columns; check that it still starts before relying on this.
- **A migration failed part-way:** do not re-run blindly. Read the migration table to see what was
  recorded, restore from the restore point if the state is unclear, and rerun from step 4.
- **Data wrong after release:** stop entries and restore from the restore point only on the named
  approver's decision. Anything entered after the restore point is lost and must be re-entered by hand;
  say so before deciding.
- Never reverse a migration by hand-written SQL on production.

## 6. File hashes (SHA-256) at the head of the integration branch

Recompute with `shasum -a 256 src/platform/db/migrations/<file>` on the release commit. If a hash
differs from this table, find out why before going on. If a migration was legitimately changed after
this draft, update this table in the same commit.

```
0551cc923e031a4fa8d3245c53e9467fb1c6650c38253dfec4b72d1626974aed  0025_customer_credit_station_scope.sql
22f56a2cdd441a77a124e421e9c4a57b186bd1e773ee70b1897e5235f992bb83  0026_staff_invite_onboarding.sql
b832b8a5501de4e5ccc1baf4950bac9a00575f9fab289cd915ab1a31be8324de  0027_clerk_staff_number_auth.sql
e840326318c53e5a17198b3fb3122d69eef1d51321afc6f13725e89f7bf4cf0a  0028_clerk_target_identity_revocation.sql
3530bb5dd38d46f8c1c74e8688f70f3634e8368ff877cd20b2014cd082a36a84  0029_staff_number_registry_rls.sql
dc353781a35a4dfce49df15f1ec46bd4c8459ec676757266d31c8b6d724e5410  0030_clerk_only_application_users.sql
a935c5cab8f19e582218cf73f345ef4d3d34b2c48bf3cd12a992abce85a0ea82  0031_manual_activation_attempt_limit.sql
5b555c9965d800afdc0b81f3e0eeb8aac9bad6fc5e21cc3fd80758f57cbe3a10  0032_custom_staff_numbers.sql
b95ea41d6d3338ce3bd555a526e35cc4dc0f41d8d173684dbf30f38a3d7fb5e6  0033_finance_reconciliation_return.sql
475026896debea750181335460140f6c78b263060c58616af2dfb9f6937ed747  0034_navigation_context_snapshot.sql
6844296c150e70df06778ab43421616d78d1d90aa8c06c049f4b33e24248e267  0035_expenses.sql
fabe978dc11ddc2e8cfcc3749462a725079841aaa1d1fdb32b12c0ae16e14ce1  0036_purchase_orders.sql
27f3bfdbffa64cb137c9c464929c02246ce7fe5b2ce17524569549bbe27e911f  0037_supplier_invoice_lines_and_policy.sql
342b13aa6e75d84a809d988085893ec0d82f14da34f6710a7698cc45ddf08e82  0038_supplier_document_reference_reuse.sql
71b4f0e78efbaa4b3edd8c284bb9c92a9b60f6cda3a17a3cfa116fe320c4e07e  0039_expense_attachments.sql
30b767e5de3c3ebdc0af565ece40f9b94b8b9566fb1cba39c7eceecbceb587cc  0040_recurring_cost_adjustments.sql
fbff3843eef8f5ba1a632b2b933a36c5a47caa639ca3b57a505dc637955b0b28  0041_responsible_supervisor.sql
fc2ed985cd67be5544081542c8b0293f5310d143345b3c6dd328b2ce1f9aef29  0042_payment_customer_and_beneficiary.sql
481ce7bd1fac06c1f4c687cc896122540bd715178af8f0605a8f9ef357efdf8c  0043_cash_handover_resolution.sql
7464138de987d7b12c630ce121d342b8bb6b8640eec1f1c2ba0c4af653a261c9  0044_tank_calibration_versions.sql
6813f124f4c4c03c39cc13d964d83ced7383f350dd6c07b87fa41b4c825dd9ba  0045_supplier_credit_limit.sql
fd036e29004b5bb0744472fe389d3b4a9acb3d58b27a63f5c7503a79ad4310a7  0046_alert_settings.sql
dedc52fc6e5a150b660606b4d9a0b182ef8f109b229823b69c688caa67b743c7  0047_unified_expense_evidence.sql
c2f4db9e24886ba0521465883f7c7c9ebb14304700f874d63c6f197e689447c3  0048_unified_expense_corrections.sql
14ad85e122d08a0941613a4e5a35782df3ca2c2fae010f29b2a2be4aa4346ac9  0049_documents.sql
```

## 7. Release record (copy this and fill it in)

```
Release date:
Release commit (full SHA):
Vercel deployment ID:
Operator:                      Approver:
Production migration count before:        after:
Last migration tag after:
Restore point identifier:
Checks green at commit (CI run link):
Browser + accessibility suites run? (yes/no, link):
Skipped suites and why:
Smoke test passed (time, who):
Reopened to staff (time):
Problems found:
```
