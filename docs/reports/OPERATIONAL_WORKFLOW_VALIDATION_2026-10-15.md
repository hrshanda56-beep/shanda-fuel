# Operational reconciliation — consolidated verification report

Date: 2026-10-15 (Africa/Harare).

**Status: implementation complete and local integration checks green.** This is
real application work toward production. Synthetic data was used exclusively for
isolated tests. Production release and hosted Clerk verification are not claimed.

## Candidate and commits

- Base: `99bbe34cd9e978288f4ffb55fcad9f144e127922`, fetched `origin/main`.
- Branch: `codex/operational-workflow-fixes`.
- Worktree: `/Users/wolftech/.codex/worktrees/owner-demo-backend/shanda-fuel`.
- Initial API/UI handoff: `b8e2ffb`.
- Implementation and tests: `be6c02fc9cf52850a03add64e16af6f4e6e8eea4`.
- This report is a documentation-only follow-up; the application/test tree is
  unchanged from the implementation commit.

The worktree directory retains its original creation name. No separate demo
backend, production fixture data, or alternate operational product was introduced.

## Fixes and files

| Area | Verified cause and resulting behavior | Main files |
| --- | --- | --- |
| Attendant lookup | Self-only membership RLS hid assigned attendants from station Supervisors. 0030 adds SELECT-only visibility for active, unexpired attendants at the validated station, gated by the actor's existing scoped operational permissions. Eligibility locks the assignment rather than requesting an UPDATE-policy-visible membership row. List expiry now matches current command eligibility, with duplicate rows removed. | `daily-operations.ts`, `persistence.ts`, migration 0030 |
| Segment and posting permissions | PostgreSQL row locks require UPDATE on at least one column, including in existing invoker validation triggers. Grant only `UPDATE(id)` on four immutable evidence tables. Existing triggers reject changed IDs, no-op updates and conflict updates; no operational/economic field or table-wide UPDATE/DELETE is granted. All original segment locks are retained. | migration 0030 |
| Downstream posting locks | Read-only cost projection and immutable allocation/revaluation/revenue lookups requested unnecessary UPDATE locks. Remove those locks; retain/explicitly acquire tank locks for cost-stream serialization, existing capabilities and uniqueness constraints. | `costing/persistence.ts`, `revenue/persistence.ts` |
| Secure approval | Clerk approval previously had no matching action-bound assurance contract. Add `APPROVE_RECONCILIATION`, requiring strict MFA even for tenant Owners. Both review routes now expose existing Better Auth enrollment/password/TOTP or Clerk reverification, followed by the existing final approval confirmation. Cancelled, failed, duplicate or stale verification cannot post approval. | `clerk-step-up.ts`, `identity/step-up.ts`, auth step-up route, forecourt application policy, `reconciliation-approval-button.tsx`, both review workspaces |
| Tests and documentation | Separate synthetic Owner/Supervisor/Attendant fixtures, real MFA/session rotation, real runtime application connections, immutable-history/rollback checks, exact ordered migration hashes, canonical architecture/decision/status/plan updates. | focused integration/E2E tests, migration history tests, DEC-042, approval UI handoff |

No new business tables/columns, accounting calculations, human role permissions,
bootstrap behavior, or production fixtures were added. Existing providers,
server authorization, session/tenant/action/expiry checks, RLS/FORCE RLS,
immutable guards, idempotency/version checks and decimal contracts are retained.
Tenant RLS and explicit application station authorization/predicates remain the
established boundary; this report does not claim that every legacy table has
station-specific RLS.

## Fresh-database and test evidence

Dedicated loopback-only PostgreSQL **18.6**, port **55438**, timezone **UTC**;
canonical bootstrap followed by **31 migrations, 0000–0030**. Separate fresh
integration and browser databases were used. No existing development database or
provider cluster was repurposed.

Migration 0030 SHA-256:
`f227d4ce49d153a8fc8379cef7d9c37bfd91aab264a8d6526c0cb893f8099b7c`.

| Gate | Result |
| --- | --- |
| Full unit suite | **842 passed**, 111 files |
| Full PostgreSQL integration suite | **141 passed**, **23 intentional skips**, 23 passing files / 3 skipped files |
| Focused browser suite | **4 passed** using `app_runtime` |
| Independent command/Clerk/session checks | **27 passed**; final diff review found no blockers |
| Typecheck | PASS — `pnpm typecheck` |
| Lint | PASS — `pnpm lint` |
| Format | PASS — `pnpm format:check` |
| Production build | PASS — `pnpm build`, with local synthetic configuration |
| Migration structure | PASS — `pnpm db:check` |
| Diff whitespace | PASS — `git diff --check` |

The 23 skipped tests are the three explicitly opt-in first-user/first-Owner/
PostgreSQL-role-preflight suites. They were not run against production and are
not reported as passing.

Verified flow:

1. Station Supervisor loads assigned active attendants; other-station,
   other-tenant, expired and disabled cases are denied or absent.
2. Supervisor confirms boundaries and seals canonical meter segments under the
   real runtime role, then successfully uses the browser **Close meters** action.
3. Supervisor selects the distinct attendant and saves payment evidence/counted
   cash; persisted data survives refresh.
4. Supervisor submits reconciliation; return-for-correction requires a reason,
   and corrected evidence can be resubmitted.
5. Owner enrolls/verifies actual Better Auth TOTP and establishes password/TOTP
   step-up, following normal session rotation. Wrong passwords and cancelled
   verification do not approve anything. Clerk wrong-action/tenant/expiry and
   strict-MFA requirements are covered by server authorization tests.
6. Owner approves through both review surfaces. Concurrent/stale approval and
   retries retain the established contracts. Canonical sale, inventory, cost and
   revenue evidence is persisted; edits after approval are rejected.
7. Financial integration coverage retains exact-value/golden scenarios,
   insufficient-stock/unvalued rejection and transactional rollback behavior.
8. Runtime catalog checks prove all four tables retain RLS/FORCE RLS,
   `has_table_privilege(...,'UPDATE') = false`, and only `id` has column UPDATE.
   OPEN/SEALED segment writes, populated attribution writes and other immutable
   source writes are rejected. A transactional reversal removes policy/column
   grants without changing evidence, then restores the candidate on rollback.

Existing responsive/mobile keyboard and workspace accessibility checks are part
of the focused browser suite; no accessibility violations were reported there.

An initial broad integration attempt lacked the required synthetic signing/auth
configuration and exposed stale migration-count expectations. The configured
fresh rerun passed, with assertions strengthened to compare every canonical
migration hash. A final browser rerun refined an ambiguous text locator to the
persistent approval status; no security or financial assertion was weakened.

## Reproduce locally

Use a new disposable PostgreSQL 18 database. Never substitute a production or
staging URL. Bootstrap with `ops/db/bootstrap.sql` and
`scripts/db/bootstrap-first-user-provisioner.sql`, then run the canonical
`pnpm db:migrate:test`. Preserve migration ownership and the existing role
restrictions. This local trust cluster gave `app_runtime` LOGIN solely for
loopback runtime tests; no production principal was changed.

Supply the repository's synthetic `APP_ENV=test`, `AUTH_PROVIDER=BETTER_AUTH`,
`APP_URL`, `BETTER_AUTH_SECRET`, `AUDIT_SIGNING_KEY_ID` and `AUDIT_SIGNING_KEY`
values used in CI. Use local database URLs only:

- Integration: `DATABASE_URL` is the synthetic fixture-owner connection;
  `TEST_RUNTIME_DATABASE_URL` is the `app_runtime` connection. Run
  `pnpm test:integration`. A5/A11 application requests use the runtime URL;
  fixtures retain their separate owner connection.
- Browser: `DATABASE_URL` is `app_runtime`; `DATABASE_FIXTURE_URL` is the separate
  fixture-owner connection. Set `APP_URL=http://127.0.0.1:3100` and run
  `pnpm test:e2e tests/e2e/production-reconciliation.spec.ts --workers=1`.
  Playwright starts/stops the local application and exercises real MFA.
- Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm db:check` and `pnpm build` for the remaining gates.

The final local databases were `shanda_workflow_acceptance` and
`shanda_workflow_browser_verified`. Test infrastructure remains disposable.

## Release and integration requirements

1. **Hosted Clerk verification remains unverified.** No authorized disposable
   Clerk test instance was supplied. The strict action contract and provider UI
   integration are implemented/reviewed/unit-tested; no successful external Clerk
   MFA ceremony is fabricated. Verify it with synthetic users in an authorized
   Clerk test instance before claiming production-provider end-to-end readiness.
2. No separate validated Claude UI SHA was delivered. The repository handoff is
   `docs/contracts/RECONCILIATION_APPROVAL_UI_HANDOFF.md`; this candidate includes
   the working approval component. If another UI commit is delivered, review its
   diff and rerun the combined gates before integration. Claude's worktree and
   uncommitted files were untouched.
3. Independently inspect production migration state and approve an exact release
   plan. Historical canonical notes defer migration 0025: a general migration
   runner could apply other pending migrations, so do not infer that the local
   full-chain result authorizes them. Migration 0030 is not applied in production.
4. Apply only an explicitly approved canonical migration plan, deploy only with
   separate authorization, record the exact approved release SHA, and complete
   authenticated production smoke/owner acceptance. No hosted CI result is
   claimed for this unpushed branch.
5. Rollback is catalog-only, after draining incompatible in-flight operations:
   a separately reviewed **compensating migration** drops
   `memberships_station_attendants` and revokes `UPDATE(id)` on
   `meter_segments`, `inventory_movements`, `inventory_cost_events` and
   `inventory_sale_cost_attributions` from `app_runtime`. It does not change
   evidence or delete/rewrite migration history. The original fail-closed
   operational limitations return. This is a release procedure to review, not
   authorization to execute it against production.

## Operation accounting

- Production contacted: **NO**.
- Staging contacted/mutated: **NO**.
- Production migrations/permissions changed: **NO**.
- Push / merge / deploy: **NO / NO / NO**.
- Local scoped commits: **YES**.
- Independent review: **GREEN**, including final cancellation/immutability deltas.
- Safe for review/integration: **YES**; production release remains gated above.
