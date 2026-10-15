# Integrated owner workflow — local verification

Date: 2026-10-15 (Africa/Harare).

Branch: `codex/workflow-integrated-verification-20261015`.
Base: `99bbe34cd9e978288f4ffb55fcad9f144e127922`.

This is an isolated local integration. Production/staging contact, push, merge,
deployment and production migrations are not authorized or performed. Historical
production status elsewhere in the repository was not reverified by this task.

## Incorporated contributions

The candidate preserves the existing committed integration history through
`76d3ed9`, including operational commits `b8e2ffb`, `be6c02f`, `60b063d`, Claude's
frontend series through `d941bdd`, quality tests `3a53601`, and demo tooling
`76d3ed9`. Stable patch IDs prove `3a53601` is identical to authorized `99dacfb`
and `76d3ed9` is identical to authorized `043cf36`; duplicate cherry-picks were
unnecessary. No source worktree was reset, stashed, committed or otherwise changed.

The final delta incorporates the authorized Quick Actions CSS correction,
projects actual `submitted_by` into the review model, uses it for the UI
self-approval guard, and prevents automatic duplicate draft creation while an
existing reconciliation ID is loading. Task-relevant pending workflow tests and
their reusable synthetic fixture were copied from the prior integration worktree
and verified here. Its separate rehearsal scripts/runbook and remaining changes
were preserved in that worktree. The inherited local seed script was formatted
without changing behavior to satisfy the repository formatter.

Independent review identified a partial-write retry defect in Close Meters.
The correction freezes command bodies and idempotency keys before sending,
persists the attempt per tenant/station/shift in session storage, and restores
it conservatively after reload. Inputs/dismissal remain frozen after partial or
ambiguous writes. A definitive rejection of the first command permits correction;
restored attempts always retain uncertainty. Numeric input respects the existing
NUMERIC(18,3) boundary. The server continues to own authorization, idempotency,
financial posting, expected versions and immutable evidence.

## Evidence

Validation uses fresh loopback-only PostgreSQL 18.6 on port 55483, UTC, synthetic
data, separate fixture-owner and `app_runtime` connections, and separate browser
and integration databases. Canonical bootstrap and all 31 migrations execute
under `migration_owner`. Catalog evidence: 73/73 application tables retain RLS
and FORCE RLS; no application security-definer ownership mismatch.

- Unit suite: 870 passed with two workers before the last bounded recovery delta.
- Focused forecourt/identity/auth unit rerun: 126 passed after the recovery changes.
- Focused financial/authorization integration: 64 passed, zero failed/skipped,
  across eight files. Includes A3, A5, A11, customer accounts, golden financial
  scenarios, operational runtime isolation, session boundaries and step-up.
- Independent review: GREEN on the final recovery, identity and frontend delta.
- Browser: 4 passed, zero failed/skipped (`browser6.log`), 40.2 seconds.
  Includes 390px keyboard/no-overflow and axe checks; actual two-nozzle attendant
  attribution; a committed seal response lost in transit; reload/retry with the
  exact same request; fixed Cash/EcoCash/POS payments totaling 750.0000;
  return reason/resubmit; role/station/no-step-up denial; cancelled and failed
  password verification; real password/TOTP approval; reload persistence;
  exact canonical inventory postings and rejected post-approval edits.
- Typecheck and subsequent direct TypeScript check: PASS.
- Full lint plus bounded final lint reruns: PASS.
- Full format check plus final changed-file checks: PASS.
- Migration structure and diff whitespace checks: PASS.

Logs are local evidence under `/private/tmp/shanda-final-*`, including
`integration-clean.log`, `unit-verified.log`, `delta-unit.log`, and `catalog.log`.
They are not committed and contain only synthetic test context.

Earlier attempts are not passing evidence: unconstrained worker startup caused
unit worker/timeouts; five-second multi-command financial scenarios timed out;
an invalid reused-MFA fixture rerun was discarded. Fresh integration databases
with a 30-second per-test limit passed without weakening financial/security
assertions. Browser assertions were aligned to the current sentence-case UI and
explicit confirmation dialog. Cold dynamic loading receives a 30-second wait.
The keyboard-focus assertion retries focus across asynchronous context rendering.
One approval test timed out consuming a browser response body after the database
had already committed APPROVED; the final assertion checks HTTP status and polls
the authoritative persisted state instead. The integrated two-nozzle fixture
starts after the preceding scenario's canonical boundaries; an earlier overlapping
fixture interval truthfully produced a rejected stale opening reading.

## Limits and release boundary

This task does not rerun broad historical audits or opt-in provisioning suites.
Hosted Clerk MFA is not exercised; this local release candidate is tested through
real Better Auth password/TOTP enrollment and verification. Clerk strict-action
policy remains covered by focused tests. Any hosted-provider release needs its
applicable provider evidence. Session-storage-denied browsers retain retry state
only while the sheet remains mounted; cross-tab/device recovery is not claimed.

Migration 0030 remains unchanged from its reviewed operational contribution.
No new migration, permission, RLS or MFA relaxation was introduced by integration.
Production migration state and the historical 0025 sequencing require separate
release review and explicit authorization. This local result grants no release
permission and makes no new claim about deployed state or owner handoff.
