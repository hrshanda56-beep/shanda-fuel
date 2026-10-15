# Independent Phase 1 workflow quality gate — 2026-10-15

## Identity and scope

Agent 3 owns this test-only change and independent evidence. Integration remains
Agent 1's responsibility. Base/current main was verified with `git ls-remote
origin refs/heads/main`: `99bbe34cd9e978288f4ffb55fcad9f144e127922`.
Branch: `codex/phase1-independent-quality-20261015`.
Worktree: `/Users/wolftech/.codex/worktrees/phase1-independent-quality/shanda-fuel`.
Backend reviewed independently: `60b063df20a6a8e32f1a5a06120edcc19d56cac8`,
exported with `git archive` to `/private/tmp/shanda-agent3-candidate`.
The final test/report commit is identified by `git rev-parse HEAD` on this branch.

No backend commands, UI, migration 0030, schema, auth behavior, seed scripts,
production/staging resources, or another agent's files were changed. No push,
merge, deploy, production contact, or staging contact occurred.

## Permanent workflow acceptance matrix

Every station operation requires authenticated identity, active tenant membership,
authorized tenant/legal-entity/station scope, and persisted station timezone.
Names below describe current permission contracts, not a newly invented role
matrix. Supervisor is an operator in the tested entry journey; Owner or another
explicitly permitted independent actor approves. DEC-032's eventual Supervisor
approval semantics do not silently grant the current SUPERVISOR role approval.

| Step | Required role/permission and configuration | Authoritative API/command and success | Denial/error and automated evidence | Remaining gate |
| --- | --- | --- | --- | --- |
| 1 Sign in | Active configured Better Auth account; session, membership; MFA policy as configured | `/api/auth/*`; authenticated session resolves | Invalid/expired/revoked session denied; A1 isolation, security-step-up, login-mfa E2E | Integrated login/provider configuration must be rehearsed |
| 2 Stations/attendants | Supervisor `reconciliation.view` or applicable capture grant; active station-scoped ATTENDANT assignments | `GET /api/forecourt/operations/daily`; only authorized attendants | 0030 raw runtime tests deny other station/tenant, disabled/expired memberships | Combined Claude dropdown browser check |
| 3 Open day | `business_day.open`; active station, valid station date | `POST /api/forecourt/commands`, `OpenBusinessDay`; one authoritative day | Same-key retry idempotent; conflicting day rejected; A3 business-day lifecycle | Final integrated rehearsal |
| 4 Start shift | `shift.start`; open day, configured template/timezone, expected version | `StartShift`; persisted station/date/shift interval | Wrong station/template/date/inactive template denied; A3 lifecycle and segmented shifts | Final integrated rehearsal |
| 5 Readings | `meter.boundary.capture`; eligible attendant, installed meter/nozzle, shift, boundary lineage | `ConfirmBoundary`; persisted reading evidence | Unauthorized scope, invalid lineage/readings denied; A3 segmented/lifecycle | Per-nozzle combined UI check |
| 6 Close/seal | capture/`shift.close`; opening/closing boundaries, prices, expected versions | `SealSegment`, `CloseMeters`; exact sealed segment and closed meters | Stale version/duplicate state rejected or same-key replay per contract; 0030 locks and immutable evidence tests; A5 production flow | Dedicated dropped-response close/retry browser scenario remains missing |
| 7 Payments | `reconciliation.submit`; existing reconciliation, supported methods, decimal amounts, required attribution | `SavePaymentAllocations`; canonical evidence reload | Invalid method/amount and submitted edits denied; A5/domain suites | Claude fixed rows/blank amounts integration |
| 8 Expenses | `reconciliation.submit`; supported expense evidence, method and decimal amount | `SaveExpenses`; server-persisted draft evidence | Invalid/negative amounts and immutable state denied; A5/domain/E2E | Full expense approval lifecycle is separate Phase 1 scope |
| 9 Calculate | `reconciliation.view`; sealed effective segments, valid selling prices, declared evidence | Reconciliation detail GET; server exact money/litres/cash/stock totals | Missing/unvalued evidence remains unavailable or blocks finalization; A5, daily-reconciliation, statement tests | Four-decimal display/export contract must be checked separately where required |
| 10 Difference | Same read scope; authoritative totals and explanations | Detail GET/UI; signed variance and truthful missing state | Nonzero required variance explanation blocks submit; A5/domain/statement tests | Combined review UI |
| 11 Submit | `reconciliation.submit`; complete evidence, current version, explained discrepancies | `SubmitProductionReconciliation`; SUBMITTED header, pending approval revision | Missing evidence/stale version denied, drafts lock; A5 integration/E2E | Final UI message after server acknowledgment |
| 12 MFA | Owner/authorized approver; enrolled Better Auth factors, current session/tenant | `/api/auth/step-up`; verified expiring tenant-bound step-up | Password/TOTP failure, wrong tenant/session, expired/revoked session denied; security-step-up and new approval-session tests | Release environment policy independently verified before release |
| 13 Approve | `reconciliation.approve` + current MFA; independent actor, submitted revision, stock valuation | `ApproveProductionReconciliation`; APPROVED, atomic authoritative posting | Supervisor/Attendant without grant denied; self/stale/concurrent/stock failure guarded; A5 and new session boundary suite | Final combined browser gate |
| 14 Audit/status | Authorized reconciliation/audit reader | Detail/audit read; persisted approval actor/status/events | Restricted audit controls; A11/A5 and focused browser tests | Do not infer success from a local button state |
| 15 Reports | `report.view`; authorized station(s), finalized source facts and period | Reporting summary/export APIs; A10 authoritative facts | Unauthorized selection denied atomically; unvalued facts unavailable; A10 reporting integration | Direct one-journey report-after-approval browser assertion remains missing |

## Findings and ownership

1. **P1 baseline defects, fixed by Agent 1 candidate:** applying canonical main
   only leaves a Supervisor's station attendant list empty and `SELECT ... FOR
   UPDATE` on `app.meter_segments` fails with `permission denied`. Reproduced
   using candidate `operational-workflow-security.test.ts` against the separate
   current-main database: 4 failed/0 passed. The fourth failure expects the 0030
   policy for rollback testing and is expected when that migration is absent.
   The same four tests pass on the candidate. Preserve 0030; no manual GRANT is
   an acceptable release procedure.
2. **Harness, not product:** postgres-js ignores `PGOPTIONS=-c role=...`.
   An early migration run therefore left
   `create_meter_exception_for_unavailable_boundary` owned by `postgres`.
   A new database migrated through an actual `migration_owner` connection
   confirms the expected owner. Do not patch the function or weaken RLS.
3. **Coverage gap closed:** new `approval-session-boundary.test.ts` exercises
   actual HTTP dispatch with persisted sessions: expired/revoked sessions 401;
   expired/missing/wrong-tenant step-up 403; Supervisor/Attendant without
   approval permission 403; station-scoped Owner outside station 403. A valid
   Owner+MFA control reaches 404 for an intentionally absent reconciliation.
   This proves authorization ordering, not successful posting. Financial
   absence assertions cover reconciliations and inventory movements.
4. **Documentation conflict:** base canonical status/plan includes historical
   production SHA `2c73049...`; current human assignment establishes accepted
   release `99bbe34...`. Neither is independently verified against production
   in this assignment. Agent 1 must reconcile canonical status for the approved
   integrated release. Do not rewrite historical evidence.
5. **Product scope:** complete role matrix, richer expenses/cash/customer and
   interruption workflows remain separately gated; passing this bounded
   journey cannot declare all Phase 1 complete. Owner/Admin approval follows
   actual current permissions rather than invented Supervisor grants.

## Evidence and reproducibility

All data synthetic. Local PostgreSQL 18.6 cluster:
`/private/tmp/shanda-agent3-quality-pg18`, port 56433, UTC. No provider database
was contacted. Disposable roles have no production credentials. Runtime login
was enabled locally for fixture/runtime connection separation; no manual table
GRANT was used. Fresh candidate chain contains 31 migrations (0000–0030).

Initial candidate catalog: all 73 app tables RLS + FORCE RLS, app_runtime and
migration_owner NOSUPERUSER/NOCREATEROLE/NOCREATEDB/NOINHERIT/NOBYPASSRLS.
The ownership correction requires the verified fresh-run evidence below.

Commands (non-secret test environment variables omitted):

- `pnpm db:migrate:test` using actual migration_owner direct connection.
- `pnpm test:integration tests/integration/a1-isolation.test.ts tests/integration/a3-business-day-lifecycle.test.ts tests/integration/a3-segmented-shifts.test.ts tests/integration/a5-production-reconciliation.test.ts tests/integration/security-step-up.test.ts tests/integration/operational-workflow-security.test.ts tests/integration/a11-daily-operations.test.ts tests/integration/a10-management-reporting.test.ts tests/integration/approval-session-boundary.test.ts --testTimeout=30000 --hookTimeout=30000`.
- Fixture `DATABASE_URL` is local postgres; `TEST_RUNTIME_DATABASE_URL` local
  app_runtime. Candidate A5/A11 explicitly use runtime; not every legacy suite
  is a pure runtime proof. Raw 0030 tests explicitly SET LOCAL ROLE app_runtime.
- `pnpm test:unit src/modules/forecourt src/modules/identity/step-up.test.ts src/modules/identity/clerk-step-up.test.ts src/app/api/auth/step-up/route.test.ts src/app/api/forecourt/commands/route.test.ts`: **117 passed, 0 failed, 0 skipped** (18 files) on main plus test-only patch.
- Main plus patch session integration: **11 passed, 0 failed, 0 skipped**.
- Earlier candidate integration: **61 passed**, plus new suite **10 passed**;
  these preceded corrected trigger ownership and are superseded for the fresh
  database gate by the final rerun below.
- Original baseline: **33 passed, 1 failed** (five-second MFA test timeout).
  The explicit 30-second rerun passed without assertion changes or sleeps.
- `pnpm typecheck`: PASS. Focused new-file ESLint and Prettier: PASS.
- Independent reviewer read test and contracts: GREEN, no blocking issue;
  reviewer did not independently rerun tests. Disposable fixtures are retained.
- Browser uses app_runtime and separate DATABASE_FIXTURE_URL, real Better Auth
  MFA, port 3143 with reuseExistingServer=false. Temporary config changes only
  port/server isolation; no application change. First launch rejected external
  node_modules symlink; local offline frozen install corrected harness.
- Earlier four-test browser attempt: **2 passed, 1 failed (30s timeout waiting
  APPROVED), 1 did not run**. Final rerun uses 90s test budget for cold compile
  and real MFA, no arbitrary sleeps, no assertion weakening.

Build/full lint/full format/full unit/hosted CI were not rerun for this test-only
patch. They remain integrated-candidate gates owned by Agent 1, not PASS claims.
Provisioning suites were not selected; no provisioning PASS or skip count is
claimed for suites not run. Local logs are evidence artifacts, not committed
credentials or production evidence.

## Acceptance gates and handoff

**Demo:** NO-GO until exact integrated Claude+backend SHA passes the real
Supervisor close/payment/reconciliation and independent Owner MFA approval
journey, exact values and refreshed status, authorized attendants, no manual
GRANT, intended auth provider, focused E2E, and no false success/bypass.

**Phase 1 operational readiness:** PARTIALLY VERIFIED for the bounded existing
workflow. Full lifecycle/policy/recovery scope remains open. Missing direct
network-loss close retry, pre-confirmation success-message, and report-after-
approval assertions should become focused permanent tests in their owning lanes.

**Production release readiness:** BLOCKED pending Agent 1 combined validation,
independent integrated review, migration-state/0025 sequencing review, exact
approved SHA, explicit release authorization, authenticated smoke and owner
acceptance. No local result authorizes production operations.

Agent 1 should review and cherry-pick the test/report commit from this branch;
Agent 3 does not modify the integration branch. Rerun the new test with the
combined candidate, fixture owner URL and TEST_RUNTIME_DATABASE_URL=app_runtime.
Preserve migration 0030 unchanged. Confirm migration-owner identity using catalog
ownership, not PGOPTIONS. Resolve the explicit browser result before GO, update
canonical current status without erasing history, and record the final approved
SHA. No new hosted Clerk gate is inferred for an actual Better Auth release.

## Final resumed-run evidence

QUALITY GATE: **PARTIALLY VERIFIED** overall; the supplied backend candidate's
focused local database/browser gates are **PASS**.

- Corrected actual migration_owner fresh database: **31 migrations PASS**;
  **73/73 app tables FORCE RLS**, **0 app security-definer ownership mismatches**.
- Final focused integration: **71 passed, 0 failed, 0 skipped**, 9 files,
  88.31 seconds. Log: `/private/tmp/shanda-agent3-verified-integration.log`.
- Final focused Chromium E2E: **4 passed, 0 failed, 0 skipped**, 2.2 minutes.
  Log: `/private/tmp/shanda-agent3-verified-e2e.log`. Includes actual MFA,
  persistence/reload, stale action recovery, return/resubmit, approval and
  post-approval immutability. The earlier timeout is superseded by this pass;
  no product regression was established by it.
- New test independent review GREEN; test-only branch typecheck, focused lint,
  Prettier and diff checks PASS. No product fix was needed in Agent 3 ownership.
- Agent 1 integration branch observed at `d941bdd8cfbc6bb0fb5776f544fca141a5b5c0b3`
  containing Claude's payment/attendant changes. That combined SHA was **not**
  independently tested here; the supplied backend SHA was. Therefore combined
  demonstration remains **NO-GO pending Agent 1 final integrated evidence**,
  not a claim the backend journey is failing.
- No production/staging contact, push, merge or deploy. No migration edits.
  Safe for review/integration as a test-only patch; production release blocked.

The interruption was an automatic approval-review usage-limit failure, not a
finding that the local action was unsafe. Resumed checks completed successfully.
Disposable synthetic databases/cluster remain available for Agent 1 reproduction;
they are not shared business environments.
