# MFA and browser release evidence — 2026-10-16

Status: **NO-GO for release.** MFA security proof is green; a clean complete browser matrix remains outstanding. This is local evidence, not production approval.

## Exact candidates and counts

| Scope | Exact tested commit | Passed | Failed | Flaky | Intentional skips | Not run |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Complete development browser matrix | `f3f7de48545a1a28aa364d1d0be445101fbf7dfc` | 327 | 7 | 0 | 4 | 1 |
| Final reconciliation and shell regression suites | `26b579ab2f5c6a80ba09e0afae5fd62e17e3aa62` | 22 | 0 | 0 | 0 | 0 |

The complete matrix ran uninterrupted for 33.8 minutes: PostgreSQL 18.6, newly migrated disposable database, fresh worktree-local Next.js cache, development webpack server, one worker, zero retries. The launching process proved its database name and PostgreSQL version before Playwright. Four screenshot cases intentionally require `SCREENSHOT_DIR`; one serial reconciliation case was not run after its predecessor failed. JSON reports combine intentional skips and serial not-run cases; the table separates them.

Final focused execution used another freshly migrated database and the exact committed correction. It is not a substitute for a full matrix on that commit.

## Security proof

The real Better Auth password/authenticator flow passes. Expired step-up returns **403**, reconciliation remains **SUBMITTED**, sale-recognition posting count remains zero, and the inventory movement snapshot remains unchanged. Fresh verification then authorizes approval. Both approval paths pass, including immutable approved records and reload behavior.

The final disposable database contained two APPROVED reconciliations, both with the expected approver membership `a5e00000-0000-4000-8000-000000000042`: one and two sale-recognition postings respectively, and exactly one subject-scoped approval audit each. The integrated two-nozzle case asserts exactly two inventory SALE movements of `-250.000` litres.

Focused session/authorization units: **28/28 passed**. Session-boundary/real step-up integration: **12/12 passed in each configuration** (database UTC/application America/New_York; database Africa/Harare/application UTC). Coverage includes absent durable records, expired/revoked sessions, missing/expired/wrong-tenant step-up, failed authoritative lookup, and mismatched session/user identity. Durable lookup remains scoped to both session ID and user ID; errors fail closed. Existing Drizzle timestamp mapping is preserved.

Independent security review approved the authoritative session boundary and retained browser corrections. Typecheck, scoped ESLint and Prettier checks passed. No application, schema, permission or financial-rule changes were made during this continuation.

## Failure disposition

The complete matrix's seven failures were reconciliation review loading; four shell cases (account/theme, chrome accessibility, phone/tablet headings); foundation smoke navigation; and staff invitation acceptance. The dependent integrated reconciliation case was not run.

The retained correction waits for DOM content plus existing shell hydration/content assertions, and explicitly requires the exact review GET to return 200/SUBMITTED before the Submitted UI assertion. All five affected reconciliation/shell cases passed in the final 22-test run. Audit counting now scopes to the reconciliation subject; staff reload waits for shell hydration. Earlier inventory/phone navigation and multi-route viewport checks also passed focused verification.

Standalone smoke/invitation pages lack the shell hydration signal. An experimental DOM-content-only change caused premature interaction in a 31-test diagnostic run (29 passed, 2 failed) and was **reverted**. Their late-run navigation/load readiness remains unresolved. No retries, sleeps, skipped assertions, or global timeout increases were introduced. Existing six/nine-route viewport tests have a documented 90-second aggregate budget based on measured 6–13-second route times; their assertions are unchanged.

The host has 8 GiB RAM and was using approximately 5.1 GiB swap during the late failures. PostgreSQL was responsive with 47 idle connections and no active lock wait; disk remained available. Development-server stream-closure errors occurred. This supports runner pressure/readiness investigation but does not prove a single root cause or a product defect. Page eviction was considered but not established. Another unchanged full run on this host is not useful evidence closure.

## Evidence and teardown

Local raw evidence is preserved outside Git:

- `/private/tmp/shanda-final-f3f7de4-results.json`, `shanda-final-f3f7de4-browser.log`, `shanda-final-f3f7de4-artifacts/`.
- `/private/tmp/shanda-focused-26b579a-results.json`, `shanda-focused-26b579a-browser.log`, `shanda-focused-26b579a-persisted.txt`.
- `/private/tmp/shanda-final-timezone-utc-db.log`, `shanda-final-timezone-harare-db.log`, `shanda-final-f3f7de4-unit.log`.
- `/private/tmp/shanda-readiness-focused-artifacts/` retains the reverted diagnostic experiment's traces.

All ten named disposable databases owned by this remediation chain were dropped; verification found zero remaining. Playwright-managed development servers exited. The shared PostgreSQL cluster and unrelated agent worktrees were preserved.

## Remaining gates and decisions

1. Resolve standalone foundation/invitation navigation and hydration readiness on a resource-stable isolated runner; obtain one complete green 339-case run on the final reviewed candidate. No new application defect or MFA bypass is established by these failures.
2. Owner to provide/confirm an isolated runner with memory headroom before another expensive full run; no production permission is needed for local remediation.
3. Previously open production 0030 authorization, BYPASSRLS security-owner decisions, Preview isolation and recovery evidence remain separate release gates. They were not re-audited here. No push, merge, deployment or production migration is authorized by this report.

Production/staging contacted: **NO**. Push/merge/deploy: **NO**. Provider settings changed: **NO**. Performance commit `fdbc20b1` remains deferred and outside this candidate.
