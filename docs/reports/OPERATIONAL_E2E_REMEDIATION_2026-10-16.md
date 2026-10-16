# Operational E2E failure remediation

Base: `871dcd45c11893149947e7ee3e412505dcc1534b`.
Branch: `codex/operational-e2e-remediation`.
Production and staging were not contacted. No deployment, migration to a remote database, push or merge is authorized by this report.

## Evidence retained and limits

The previous full matrix reported 317 passed, 13 failed, four skipped and five not run. All thirteen error-context snapshots were recovered read-only from the original integration worktree's `test-results` and copied to `/private/tmp/shanda-e2e-prior-artifacts`. The original `.last-run.json` includes failure/dependency IDs; it is not a complete count report. Original per-request traces and a complete prior JSON reporter file were not found. No files or database in that worktree were modified or restarted.

A failure snapshot shows only the state at timeout; it cannot establish which HTTP request was slow. Historical browser lifecycle suspensions cannot be retrospectively attributed to a particular OS event from those snapshots alone.

## Priority reconciliation investigation

The original failed snapshot shows the correct authorized Owner/station shell and **Loading review**, not a stale DRAFT badge. Its preceding test had required SUBMITTED on the supervisor screen. A fresh baseline-only run completed the submission/approval/immutable-edit-denial scenario; direct database inspection confirmed APPROVED. This is not proof that the historical run was harmless or a flake.

A deterministic regression now verifies SUBMITTED and the trusted submitter in PostgreSQL, independently verifies SUBMITTED through the manager's authenticated API, waits for shell hydration, and holds only the optional overview response. Before the product correction it reproduced the same Loading review failure even though the authoritative record and operation endpoints had completed. The regression attaches persisted-state evidence to the test report. No fixture from an earlier test is needed to reproduce this dependency.

Cause: `ReviewScreen.load` awaited the optional overview alongside required operation and reconciliation evidence in one Promise.all. A slow optional timeline prevented rendering the already-submitted record. The correction loads optional metadata independently and guards asynchronous results against superseded loads/unmount. Approval permission, distinct submitter check, MFA, server state/version/idempotency and financial posting remain unchanged. Rendering authoritative evidence does not approve it.

This is a reproduced sufficient cause for the original symptom, not a claim to know the timing of every historical request without its missing trace.

## Thirteen-failure classification

| Prior failure                                     | Classification and correction/evidence                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconciliation Submitted after manager navigation | Product loading dependency reproduced with persisted SUBMITTED/API evidence and hydrated shell; optional metadata decoupled; controlled regression retained.                                                                                                                            |
| Reports category/filter/accessibility             | Test defect: old link selector for Cash & banking; current UI uses Filter reports by category combobox and Cash & banking (1) option. Existing period/category assertions retained.                                                                                                     |
| UI KPI opens report detail                        | Test defect: case-sensitive Total Sales differs from actual Total sales. Detail URL/content assertions retained.                                                                                                                                                                        |
| Staff invitations/accessibility                   | Reload/hydration timing defect in helper: framenavigated alone permitted no-op Staff clicks on unhydrated replacement document. Reproduced Organisation-active snapshot after reload; helper now waits DOM and actual shell hydration. Removed swallowed ERR_ABORTED navigation errors. |
| Auth dark picker long names 430px                 | Environment: historical ERR_NETWORK_IO_SUSPENDED during navigation; no product assertion ran. Re-exercised unchanged in stable runner.                                                                                                                                                  |
| Auth dark no-workplace 768px                      | Environment: historical browser protocol session closed; snapshot already contains expected heading. Re-exercised unchanged.                                                                                                                                                            |
| UI phone table stacking                           | Environment: historical timeout creating page before test assertion. Re-exercised unchanged.                                                                                                                                                                                            |
| My Shift accessibility 768px                      | Environment/readiness timeout: no actual axe violation recorded; unchanged test re-exercised. Exact historical sub-operation unavailable.                                                                                                                                               |
| Provider explicit variance reason                 | Environment/navigation timeout waiting page load; unchanged validation assertion re-exercised.                                                                                                                                                                                          |
| Smoke mobile foundation                           | Environment/navigation timeout waiting page load; unchanged assertion re-exercised.                                                                                                                                                                                                     |
| Smoke persistent labels                           | Environment/readiness timeout with rendered design-system snapshot and no recorded assertion defect; unchanged test re-exercised.                                                                                                                                                       |
| Attention-item navigation                         | Environment/hydration timing candidate: source href is correct, original remained on foundation. Unchanged real-link navigation test re-exercised with single worker. Exact historical lifecycle cause unproven.                                                                        |
| UI accessibility at 390px                         | Environment/readiness timeout with compiling/loading snapshot, no captured axe violation. Unchanged full accessibility assertions re-exercised.                                                                                                                                         |

Passing a repeat alone is not called a flake diagnosis. The environment classifications preserve the observed failure type and the historical evidence limits.

## Stable, observable local runner

`playwright.postgres-dev.config.ts` runs **next dev --webpack**, not next start or a production build. It uses one browser worker, sequential fixtures, no retries, a new owned server on port 3119, retained failure traces and JSON output including the tested Git SHA. The normal app/CI config is unchanged. The dedicated runner uses 60-second default test and 10-second assertion limits for development compilation; explicit scenario timeouts still apply. No arbitrary sleeps or ignored assertions were added; the pre-existing pg_sleep in meter-fixture setup was removed because sequential committed boundary requests already supply ordering, which remains asserted.

The config refuses non-loopback/mismatched/non-remediation database names and requires a separate app_runtime URL. Legacy suites receive the fixture-owner URL, while the application server receives app_runtime. The bootstrap helper creates a NEW database only, requires PostgreSQL 18/UTC/loopback, runs canonical migrations under migration_owner and asserts runtime-role/RLS attributes. It does not drop databases, seed real stations or read inherited production credentials.

Use a dedicated disposable PostgreSQL cluster, never an existing station/production cluster. Example after creating that local cluster in UTC on its own loopback port:

```sh
node scripts/e2e/create-disposable-postgres.mjs remediation_full 55489
DATABASE_FIXTURE_URL=postgresql://postgres@127.0.0.1:55489/remediation_full \
DATABASE_RUNTIME_URL=postgresql://app_runtime@127.0.0.1:55489/remediation_full \
BETTER_AUTH_SECRET=local-synthetic-test-secret-at-least-32-bytes \
AUDIT_SIGNING_KEY_ID=local-e2e \
AUDIT_SIGNING_KEY=local-synthetic-audit-key \
pnpm exec playwright test --config playwright.postgres-dev.config.ts
```

Use a new database name for each repeat. Existing fixed session/role/idempotency fixtures can contaminate a reused database even when INSERT uses ON CONFLICT. Do not claim reset behavior that the fixtures do not provide. Free disk must be checked before the matrix; never delete another agent's build/artifacts to make room. Retain nonzero exits and JSON/trace evidence, then stop only the task-owned cluster/server.

## Validation record

Private local evidence is under `/private/tmp/shanda-e2e-remediation`. Baseline priority run passed; held-overview regression failed before correction with SQL/API SUBMITTED; an early corrected run exposed a new test route-cleanup error and the staff hydration race, both addressed before final focused verification. Those failed attempts remain evidence and are not counted as passing. Additional harness attempts failed because an empty optional DATABASE_DIRECT_URL was rejected and because inet address text included /32; configuration and address normalization were corrected. An invalid fixture run was interrupted after bootstrap refusal, and orchestration now fails closed before testing if creation fails. No invalid run is used as product-validation evidence.

The final delivery must state exact focused repeat counts, complete matrix counts (including intentional skips/not-run cases), independent review, static checks and final tested SHA from the JSON reporter. A complete-matrix PASS is not inferred from the focused tests. No security/schema/auth/financial behavior was weakened.

Focused verification before the complete matrix: all thirteen former failures passed once on fresh `remediation_focus5` without retries. The second fresh-database run (`remediation_focus6`) passed **16/16**, including the same thirteen and the full serial reconciliation suite, with zero skipped/failed/flaky cases and no retries. Unit checks passed 53/53; changed-file lint, TypeScript and formatting checks passed. Independent code/harness/document review is GREEN. The final matrix is deliberately run only after the expanded repeat passes, from a clean committed source SHA recorded by the JSON reporter.
