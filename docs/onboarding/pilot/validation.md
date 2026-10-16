# Validation and integration handoff

Branch: `codex/station-onboarding`.
Base: `871dcd45c11893149947e7ee3e412505dcc1534b` (human-specified operational candidate).
Accepted production baseline supplied by human: `99bbe34cd9e978288f4ffb55fcad9f144e127922`.
Final local commit identity is recorded in the delivery report; no deployment is claimed.

## Permanent correction

The six-area readiness computation previously marked PUMPS READY when pumps/nozzles existed but none had a meter installed. A synthetic unit regression reproduced the false ready result before the fix. The read-only query now counts active nozzles without a current active meter installation using tenant/station/nozzle identity and a half-open effective interval. The existing PUMPS area reports Incomplete in that case. The detailed configuration query uses the same active/time predicates for displayed meter serials, avoiding presentation of a future, ended or inactive installation as current.

No operational command, migration, RLS policy, permission grant, MFA/approval logic or financial calculation was changed. No new runtime dependency, paid service or UI redesign was introduced.

## Local evidence

Private PostgreSQL 18.6, UTC, database `onboarding_verify`, loopback port 55487; canonical bootstrap and all candidate migrations applied under `migration_owner`. Only synthetic fixtures used. Catalog verification recorded 31 migrations, 73/73 application tables with RLS and FORCE RLS, and zero app/platform security-definer functions owned by a role other than migration_owner. The private cluster was stopped after validation. Initial socket URL and HBA connection failures were harness setup failures. An early combined run hit a five-second test timeout; a retry reused fixed fixture IDs and polluted its own state. Final evidence uses a fresh database and explicit 30-second test/hook limits, without product or assertion relaxation.

- Focused setup unit tests: **12 passed** (includes new false-ready regression).
- PostgreSQL setup readiness, setup Milestone A, station activation and A4 inventory suites: **22 passed, zero failed/skipped**, four files.
- These cover empty/missing setup, provider/bank configuration, permission and tenant denials, idempotency, product/tank/nozzle/meter creation, pricing lifecycle, exact activation schedule, opening stock and inventory source/negative-stock protection.
- New integration regression checks missing/future/ended/current/inactive meter readiness and corresponding current serial display.
- Focused existing unvalued-stock/RLS regression: **1 passed, 7 deliberately filtered-out tests**; those seven are not claimed passing. Missing cost remains null/UNVALUED rather than fake zero.
- Production build: **PASS** with explicit synthetic Better Auth/test configuration and no database URL. The first unconfigured build failed closed because AUTH_PROVIDER was missing; it is not treated as a product regression or a pass.
- Changed-file TypeScript/Markdown formatting, 23 local document links, whitespace and protected-file scope checks: **PASS**. Browser/E2E/responsive tests were not run; no UI component or operational command changed.
- Route type generation: **PASS**. TypeScript `tsc --noEmit`: **PASS**. Focused ESLint on changed TypeScript/tests: **PASS**.

Logs are private local test artifacts under `/private/tmp/shanda-onboarding-pg18/` and contain synthetic context. The temporary cluster/bootstrap helper is not product tooling and is excluded from Git. No demo seed was used for onboarding.

The existing integration files construct fixtures using the local test database owner. API authorization and explicit tenant predicates are exercised, but these suites alone do not prove every production runtime-role boundary. The focused valuation test additionally checks its existing RLS behavior. Production principal/migration state and final integrated role/browser gates belong to the integration owner.

Independent bounded code/document review: **GREEN**. Reviewer inspected the actual diff and source map, independently passed 12 focused unit tests and verified 23 local documentation links. No production/staging access or file changes by reviewer.

## Outstanding implementation / release handoff

1. Provide permanent Owner-facing create/edit workflows or separately reviewed onboarding tooling for organisation/legal entity/station and currently command-only asset/product/shift/price setup. Do not ask station users to execute raw API calls.
2. Confirm an explicit physical tank/nozzle supply and multi-tank allocation contract before an ambiguous station is cut over.
3. Resolve inventory `datetime-local` browser-time conversion before cross-timezone cutover; the source evidence is `inventory-workspace.tsx`'s `isoFromLocal`. This task did not change that inventory UI or claim browser reproduction.
4. Complete/approve required opening cash/bank/customer/supplier financial cutover workflows; no general opening import was established.
5. Resolve detailed price blocker effective-window/200-row limitations; the time-aware readiness summary must not be replaced with an ACTIVE-label shortcut.
6. Preserve release-owned commands, 0030, approval and MFA. Merge this bounded setup read-model change only after normal review; rerun combined candidate gates and verify explicit migration/release state separately.
7. Owner supplies pilot choice, setup facts, opening evidence, role/approver arrangement, custody policy and escalation contacts. Staff training, known-build browser rehearsal and signed acceptance remain open.

The new documents are usable collection/acceptance masters, not a claim that engineering gaps are closed. **PARTIALLY READY** remains the honest overall status until the missing supported workflows and actual station evidence are resolved. No production/staging contact, real records, push, merge or deployment occurred.
