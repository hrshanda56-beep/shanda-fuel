# Release readiness ledger

**Validated application baseline:** `7ba5e68`
**Last reconciled:** 2026-09-28
**Classification:** operational release record; it does not change domain, accounting, authentication, MFA, RLS, authorization, migration, reporting, or settlement behavior.

## Controlled Production Launch Plan — Locked Product & UX Direction

This section is locked product and launch direction. It is not an implementation
status claim and does not replace the evidence or gate statuses below.

`docs/release-readiness.md` is the supporting launch-readiness record for
execution and focused product-experience notes. Future developers and coding
agents should read this section before redesigning navigation, creating a new
visual pattern, redesigning a route or page, changing the theme system,
implementing work-in-progress behavior, changing the golden-path UX, or making
a launch-readiness decision. The canonical knowledge base remains authoritative
for repository-wide requirements and decisions.

If a future implementation conflicts with this section, follow the canonical
knowledge base for repository-wide requirements and report the conflict. Any
material change must be recorded clearly; no implementation status may be
inferred from the plan alone.

### Fixed finish line

The fixed finish line is:

> Controlled real production launch with no launch-blocking security, integrity,
> recovery, or operational gaps.

This definition must remain stable so progress is measured against the same
finish line over time.

A polished staging/demo environment is sufficient for the client to begin
seeing and reviewing the product before production launch. Client-facing
staging should become visually and functionally polished as early as possible
while launch hardening continues in parallel.

### Core product experience principles — locked

The Shanda Fuel platform must feel:

- effortless to use;
- calm, airy, premium, restrained, and modern;
- highly responsive and extremely clear;
- visually uncluttered;
- expensive and classy rather than decorative; and
- guided by “less is more.”

Ease of use is the number-one UX priority.

Every role should receive the same quality and consistency of experience.
Roles and permissions determine what a user is allowed to do, but should not
create a worse or more complicated UX for any role.

All existing screens are expected to be visually and ergonomically revamped
over time. Do not redesign screens independently in isolation. Redesign the
system from shared foundations first, then compose those foundations
consistently across the application.

Once a component or pattern is approved and implemented correctly, avoid
redesigning it again unless there is a demonstrated usability problem.

### Brand and visual direction — locked

Keep the current Shanda Fuel branding, Shanda Fuel colors, and logo.

The visual direction is:

- primarily neutral whites and greys;
- restrained use of the Shanda Fuel brand accent;
- strong whitespace and clear hierarchy;
- minimal visual noise;
- subtle premium styling;
- no excessive decoration; and
- no overwhelming dashboards.

Support both light mode and dark mode. Default to the device/system
preference, and provide a manual theme toggle/override.

Motion must be subtle and premium: small transitions, soft panel changes, and
polished loading states, with no distracting animation.

### Responsive experience — locked

The product must work well across mobile, tablet, desktop, and varying screen
sizes.

Desktop and tablet experiences must provide full functionality, clear
information density, and clean tables and charts. Mobile experiences must
prioritize quick operational actions and status checks, keep navigation simple,
and avoid copying the full desktop sidebar directly into mobile. Complex
reconciliation and reporting must still work, while naturally being more
comfortable on larger screens.

Responsive behavior must be designed intentionally, not treated as a late CSS
fix.

### Navigation — locked

Desktop navigation uses a grouped, collapsible left sidebar with simple,
business-oriented groupings. Avoid exposing technical or internal module
terminology where it is unnecessary.

Recommended grouping direction:

- Today
- Operations
- Finance
- Customers
- Suppliers
- Reports
- Settings

Mobile navigation must be adapted for compact screens and optimized for common
quick actions. Navigation may be reorganized substantially when doing so makes
the application simpler and easier to understand.

### Overview and home experience — locked

The Overview must be action-first, not KPI-first. The first thing users should
understand is: “What needs my attention right now?”

“Needs attention” should visually behave like premium notifications: compact,
prioritized, clear, non-overwhelming, dismissible where appropriate, and
role/context-aware where appropriate. It must never dominate the entire page.

Key metrics, charts, and operational summaries can sit beneath or around the
action-first content.

### Charts, tables, and information density — locked

Charts and graphs are allowed and encouraged when they improve understanding.
They must be clean, minimal, and clear, with no unnecessary decoration. Do not
use a chart for information that is clearer as a number or table; use
visualizations only where they communicate faster or more clearly.

Tables must be clean, readable, and usefully dense without visual clutter. Do
not make tables artificially spacious at the expense of useful operational
data. Prioritize scanability and hierarchy.

### Forms and workflows — locked

Prefer focused flows with fewer fields shown at once. Where appropriate, use
short sequential steps, reveal information progressively, avoid large
intimidating forms, reduce cognitive load, and make the next action obvious.
Routine tasks should remain frictionless.

Financial, destructive, irreversible, and other high-risk operational actions
must use deliberate confirmation and clear context before execution. Do not add
confirmation friction to ordinary low-risk actions.

### Standard terminology — locked

Use standard industry and business terminology. Do not oversimplify established
accounting, fuel, forecourt, reconciliation, or operational terms when the
standard terminology is clearer and expected by users.

### Work-in-progress experience — locked

Do not hide unfinished modules or sections from the client. All intended
product areas should remain visible so the client can understand the planned
product structure.

If a section or action is not implemented yet:

- keep it visible;
- use a consistent, polished “Work in progress” experience;
- use a modal, pop-up, or equivalent clear treatment;
- explain clearly that the feature is still being completed;
- avoid broken buttons, dead navigation, or confusing error states; and
- keep the application intentional and polished.

Create one reusable WIP pattern instead of implementing different placeholder
behavior on every screen.

### Client golden path — highest UX priority

The primary client/demo journey is:

`Login → Overview → Open Business Day → Forecourt → Reconciliation → Reports`

This golden path must receive the highest UX polish first. Every step should
feel obvious, fast, consistent, responsive, low-friction, and visually
premium.

The golden path should become client-ready before the full long tail of
secondary screens if necessary.

### Execution strategy

Work in parallel where the workstreams do not conflict, without compromising
launch safety.

**Track A — Launch hardening**

- Security P0
- CI security hardening
- observability
- provider and edge protections
- recovery validation
- operational launch gates

**Track B — Design system and application shell**

- design tokens, typography, spacing, sizing, surfaces, borders, shadows, and
  layout/grid rules;
- buttons, inputs, forms, tables, charts, cards, notifications, modals, and
  confirmations;
- loading, skeleton, empty, error, and WIP states;
- light/dark themes, responsive rules, and motion;
- the global application shell and navigation.

**Track C — UX implementation**

- the golden path first; and
- remaining modules using the system established in Track B.

Do not wait for all backend hardening to finish before beginning independent
client-facing UX work.

### Phases

#### Phase 1 — Finish launch-blocking foundation

Goals are to complete Security P0, CI security hardening, observability P0,
remaining launch-blocking security gaps, and recovery/operational proof while
defining and implementing the permanent design-system foundation in parallel.

The design-system foundation must cover typography, spacing, sizing,
layout/grid rules, colors, light/dark themes, shadows/borders, buttons, forms,
inputs, cards/surfaces, tables, charts, notifications, modal/dialog patterns,
loading/skeleton states, empty states, error states, WIP state, confirmations,
responsive behavior, and motion rules.

Do not perform independent page-by-page visual redesign before the system
foundation exists.

#### Phase 2 — Product shell

Build the permanent grouped collapsible desktop sidebar, mobile navigation,
responsive page shell, header/top-level controls, theme toggle,
notifications/Needs attention pattern, loading/error/WIP behavior, and global
responsive rules. The product shell is reusable infrastructure, not a
temporary redesign.

#### Phase 3 — Golden path

Perfect, in order:

1. Login
2. Overview
3. Open Business Day
4. Forecourt
5. Reconciliation
6. Reports

Focus on minimal clicks, clear primary actions, clean hierarchy, responsive
behavior, focused forms, clear operational state, fast feedback, excellent
empty/loading/error states, and premium light/dark presentation.

#### Phase 4 — Remaining product areas

Apply the locked system consistently to Customers, Suppliers, Cash,
Settlements, Inventory, remaining Reports, Settings, administration, and other
remaining routes/modules. Do not invent new visual systems per module.

Incomplete functionality remains visible using the standard WIP pattern.

#### Phase 5 — Client-ready staging and production rehearsal

Prepare a polished staging/demo experience with realistic staging data, a
complete golden path, no obvious broken/dead interactions, consistent WIP
states, responsive QA, light/dark QA, accessibility QA, browser/device QA,
performance checks, a usability pass, navigation consistency, and
loading/empty/error-state checks.

In parallel or following that work, complete production configuration
validation, security gates, observability/alerting gates, backup/recovery
gates, rollback verification, production smoke rehearsal, operational runbooks,
and the controlled launch checklist.

#### Phase 6 — Controlled real production launch

Launch only when there are no launch-blocking security, integrity, recovery, or
operational gaps. The initial production release must be controlled and
monitored.

Polished staging and production readiness are separate gates. Both are
required; neither should be treated as proof of the other.

### Execution principles

1. Build foundations once.
2. Reuse patterns everywhere.
3. Do not solve the same UX problem independently in multiple screens.
4. Do not compromise financial, security, or integrity controls for visual
   speed.
5. Do not delay independent UX work unnecessarily because unrelated backend
   work is still underway.
6. Give the golden path first-class polish before long-tail screens.
7. Keep the client-visible product structure intact, even where features are
   WIP.
8. Prefer simplicity over feature exposure.
9. Make every screen clearly answer: Where am I? What matters? What can I do
   next?
10. Require every additional control to justify its presence.
11. Treat accessibility, responsiveness, and light/dark behavior as part of
    completion, not later cleanup.
12. “Done” means the pattern should not need to be rebuilt later.

## Execution Control & Completion Ledger

This document is a supporting launch-readiness ledger for controlled production
launch execution, focused UX notes, dependencies, verification evidence, and
remaining launch blockers. Future developers and coding agents should read it
before starting launch-related work, but the canonical knowledge base remains
authoritative for repository-wide product, architecture, decision, planning,
and status questions.

If an agent's assumptions conflict with this document, follow the canonical
knowledge base for repository-wide requirements and report the conflict. This
ledger records launch execution control only; it does not replace the canonical
knowledge base, existing release gates, or the evidence and conclusions
recorded below.

The purpose of this ledger is to prevent duplicated work, stale assumptions,
premature completion claims, overlapping ownership of sensitive/shared files,
forgotten follow-up tasks, and lost launch blockers.

### Locked status model

Use exactly these lifecycle statuses:

| Status | Meaning |
| --- | --- |
| **NOT STARTED** | No active implementation work. |
| **IN PROGRESS** | Implementation is actively being developed; it is not yet considered ready for integration. |
| **BLOCKED** | The work cannot safely proceed until a named dependency is resolved. |
| **READY FOR REVIEW** | Implementation and required local validation are complete; the diff is ready for human/final review, but the work is not yet complete. |
| **MERGED** | The PR has merged to canonical `main`; the merge SHA must be recorded. |
| **VERIFIED** | The merged implementation has passed the required post-merge or environment-specific verification; this is the final completion state. |

An agent saying “done” does **not** make a task complete. A task is complete
only when this document's completion criteria are satisfied. For implementation
work, **MERGED** is normally required before the work can be considered
complete. Where staging, provider, runtime, or other environment verification
is required, **VERIFIED** is the final state.

### Current ledger summary

The summary below is the current execution-control view. Detailed records
define the scope, completion criteria, validation, evidence, and follow-up for
each workstream. `TBD` means the value is not yet known or evidenced; it must
not be replaced with an invented PR number, SHA, validation result, or owner.

### Historical production Stage 1 security closeout — 2026-10-09

**Evidence date:** 2026-10-09

**Stage 1 result:** **PASS**

**Historical Stage 1 failure:** **SUPERSEDED**

**Ready to record formal closeout:** **YES**

The historical production closeout is recorded against release SHA
`2c7304916c191c66907d9582a3e7c26225c6eb59`.

| Check | Current result |
| --- | --- |
| Migration journal and integrity | **PASS at the 2026-10-09 checkpoint** — journal through `0024`; migrations `0022`, `0023`, and `0024` counts/hashes verified. This is historical evidence, not the current `0026` checkpoint. |
| Tenant isolation and RLS | **PASS** — tenant isolation controls verified; all 67 app tables have RLS and `FORCE ROW LEVEL SECURITY`. |
| `app_runtime` | **PASS** — least-privilege controls verified, including migration-table and rate-limit-table restrictions. |
| Owner and MFA | **PASS** — active `OWNER` exists and OWNER MFA enrollment is verified. |
| Production health | **PASS** — HTTP 200. |
| Production readiness | **PASS** — HTTP 200 with database readiness `ok`. |

`job_runtime` temporary quarantine is **EFFECTIVE**. Its production password
was rotated without exposing the replacement credential; post-rotation
sessions were `0`; the deployed web app uses `app_runtime`; no active
`job_runtime` consumer was found; and health, readiness, and normal
authenticated application load passed.

| `job_runtime` quarantine | **PASS** — effective after password rotation; the role remains unbound. |
| Controlled release exception | **YES** — release may proceed with this documented security exception. |
| `job_runtime` release blocker | **REMOVED** — this role-specific blocker is no longer release-blocking. |
| Provider-level permanent hardening | **OPEN** — the role is not fully remediated. |

Required post-launch provider hardening remains mandatory: remove
`neon_superuser` membership; enforce `NOLOGIN`, `NOINHERIT`, and
`NOBYPASSRLS`; remove `CREATEROLE`, `CREATEDB`, and `REPLICATION`; remove
obsolete legacy grants; and keep `job_runtime` unbound until completion is
verified. This is a historical Stage 1 security closeout only: it does not
describe the current `0026` checkpoint or declare final production release
readiness. It does not run migrations, change production data, users, or
database roles, or alter issues `#111`, `#113`, or `#114`.

### Current Milestone A release-candidate evidence — 2026-10-13

| Gate | Evidence / status |
| --- | --- |
| Exact RC | `dadd9cd2f6efabcec30e36b939b6cdd84c0e4bcf` |
| PR / hosted CI | [PR #122](https://github.com/hrshanda56-beep/shanda-fuel/pull/122) remains open/draft. [CI run 38353115180](https://github.com/hrshanda56-beep/shanda-fuel/actions/runs/38353115180) passed quality, dependency audit, secret scan, Semgrep SAST and Runtime-role proof; CodeQL was skipped. |
| Production migration checkpoint | Read-only Neon `main` check at `2026-10-13T06:27:47Z`: database `shanda_fuel`, role `migration_owner`, PostgreSQL 18.6, 27 journal rows through `0026`, and target relations absent. `0027`–`0029` remain pending. |
| Isolated migration rehearsal | PASS on `restore-rehearsal-0027-0029-20261013` (`br-divine-paper-b2sgelew`), child of `backup-0026-20261013` (`br-spring-paper-b29ugfnk`). Exactly 30 journal rows; target hashes/order, FORCE RLS, ownership and runtime privilege checks passed. |
| MFA exception | Owner-approved temporary `REQUIRE_LOGIN_MFA=false`; `REQUIRE_PRIVILEGED_STEP_UP=true` remains enforced. Application configuration/tests verify step-up is independent of normal-login MFA enforcement. |
| PostgreSQL 18 logical backup/restore | **OPEN / NOT EVIDENCED.** Existing evidence is an isolated PITR/application/R2 drill, not a PostgreSQL 18 logical dump plus isolated logical restore. |
| Production state | Unchanged; PR remains unmerged and no production migration/deployment was performed. |

| Workstream | Phase | Status | Owner / Agent | Branch | Dependencies | PR | Merge SHA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Security P0 | Phase 1 | **VERIFIED** | Codex — Agent 1 (security owner) | `fix/security-p0-dev-csp` | None recorded | #45 | `843c3fa60977d591035157bd740c8a11a564b448` |
| Design System Foundation | Phase 1 | **VERIFIED** | Claude — Agent 2 (design-system owner) | `ui/design-system-foundation` | None recorded | #47 | `f1c7b80` |
| CI Security Hardening | Phase 1 | **VERIFIED** | Codex | `codex/ci-security-hardening-20260929` | Security P0 is verified; no dependency currently blocks starting this workstream | #49 | `12106be` |
| Observability P0 | Phase 1 | **VERIFIED** | Codex — Agent 3 after Security P0 merge | `codex/observability-p0-20260929` | Security P0 is verified; no dependency currently blocks starting this workstream | #68 | `d4f6e15` |
| Product Shell | Phase 2 | **VERIFIED** | Claude | `ui/product-shell-20260929` | Design System Foundation is verified | #71 | `d3721d3` |
| Golden Path UX | Phase 3 | **BLOCKED** | Claude — Agent 4 after shell stabilizes | TBD | Design System Foundation; Product Shell | TBD | TBD |
| Remaining Product UI/UX Sweep | Phase 4 | **BLOCKED** | Claude — TBD | TBD | Golden-path patterns and shared foundations | TBD | TBD |
| Client-Ready Staging | Phase 5 | **BLOCKED** | Codex + Claude — split technical/UX ownership; coordinator TBD | TBD | Cross-module staging access, golden path, QA, and open release gates | TBD | TBD |
| Production Rehearsal / Final Launch Gate | Phase 5 | **BLOCKED** | Codex — TBD | TBD | Security, integrity, observability, recovery, rollback, and operational gates | TBD | TBD |
| Controlled Real Production Launch | Phase 6 | **BLOCKED** | Codex — TBD; Claude supplies UX/accessibility evidence | TBD | All launch-blocking gates must be closed | TBD | TBD |

### Workstream records

Each major workstream must track Workstream, Phase, Status, Owner / Agent,
Branch, Dependencies, Scope, Definition of Done, Required Validation, PR, Merge
SHA, Verification / Evidence, and Remaining Follow-up. The records below are
the initial known state; they do not claim completion beyond the evidence
identified in each record.

#### 1. Security P0

| Field | Record |
| --- | --- |
| Workstream | Security P0 |
| Phase | Phase 1 — Finish launch-blocking foundation |
| Status | **VERIFIED** |
| Owner / Agent | Codex — Agent 1 (security owner) |
| Branch | `fix/security-p0-dev-csp` |
| Dependencies | None recorded. |
| Scope | Production audit-signing fail-closed behavior; explicit `APP_ENV` handling compatible with staging; tenant-bound privileged step-up/MFA authorization; security response headers; forward-only migration `0019` removing inappropriate auth-schema access from non-auth runtime roles; regression tests; preserve historical migrations unchanged. |
| Definition of Done | Complete the scoped Security P0 implementation, preserve migration `0002`, pass all required validation, complete diff/staged-diff review, and carry the work through PR, CI, merge, and required post-merge verification. Do not claim full runtime-role least privilege from this patch. |
| Required Validation | Fresh disposable PostgreSQL bootstrap; migrations through `0019`; `db check`; integration tests; direct privilege verification; final diff review; staging; staged diff review; commit; push; PR; CI; merge; and post-merge verification as required. |
| PR | #45 |
| Merge SHA | `843c3fa60977d591035157bd740c8a11a564b448` |
| Verification / Evidence | Post-merge verification on canonical `main` at `843c3fa60977d591035157bd740c8a11a564b448`: development CSP contained `'unsafe-eval'`; production CSP omitted it; all existing Security P0 headers and CSP restrictions remained intact; canonical `next dev` emitted no React/Next eval CSP errors; explicit `APP_ENV=staging` production startup succeeded; production build passed; and `git diff --check` passed. The corrected CI test discovery now runs `next.config.test.ts` (2 CSP assertions) as part of `pnpm test:unit`; the full unit suite passed with 47 files / 291 tests. |
| Remaining Follow-up | Provider/durable rate limiting remains separate; broader `app_runtime` least-privilege work is not claimed complete. |

Locked decisions for this workstream:

- Historical migration `0002` remains untouched.
- Rejected in-memory rate limiting is **not** part of this Security P0 patch.
- Do not claim full runtime-role least privilege from this patch.
- `app_runtime` remains separately reviewable.
- Provider/durable rate limiting remains separate.

#### 2. Design System Foundation

| Field | Record |
| --- | --- |
| Workstream | Design System Foundation |
| Phase | Phase 1 — Finish launch-blocking foundation |
| Status | **VERIFIED** |
| Owner / Agent | Claude — Agent 2 (design-system owner) |
| Branch | `ui/design-system-foundation` |
| Dependencies | None recorded. |
| Scope | Design tokens; typography; spacing; layout/grid rules; color system; restrained Shanda Fuel brand accent; light theme; dark theme; system preference detection; manual theme override; surfaces/cards; buttons; inputs; form controls; tables; chart/visualization rules; notifications; dialogs/modals; confirmations; loading/skeleton states; empty states; error states; WIP treatment; responsive primitives; motion rules; and accessibility foundations. Scope must align with the locked UX/product plan above. |
| Definition of Done | Reusable product infrastructure is implemented and documented across the defined foundation areas. This is not a one-off page redesign. Required local validation and review are complete, and the implementation is ready for the integration sequence. |
| Required Validation | Formatting, lint, typecheck, build, unit, accessibility, responsive, and theme validation before review. |
| PR | #47 |
| Merge SHA | `f1c7b80` |
| Verification / Evidence | Implementation commit `d9ec984` on `ui/design-system-foundation` remains byte-identical and intact; accessibility follow-up commit `2c1c13d` is included. Post-merge `main` was clean. Lint, typecheck, production build, and `git diff --check` passed; 52 unit-test files / 378 tests passed; `next dev` had no CSP/eval errors; `/design-system` returned 200 in development and 404 under `next start`; post-merge serial E2E with `--workers=1 --retries=0` passed 30/30; and responsive-table accessibility checks passed. PR #47 CI/quality was green before merge. The serial E2E result is not identical to CI: current Playwright CI uses `fullyParallel` and permits retries. |
| Remaining Follow-up | Continue with the next product-shell work when scheduled; retain the post-merge E2E and responsive-table evidence for future regressions. |

#### 3. CI Security Hardening

| Field | Record |
| --- | --- |
| Workstream | CI Security Hardening |
| Phase | Phase 1 — Finish launch-blocking foundation |
| Status | **VERIFIED** |
| Owner / Agent | Codex |
| Branch | `codex/ci-security-hardening-20260929` |
| Dependencies | Security P0 is verified, so no dependency currently blocks starting this workstream. Existing agent work, if any, must be reviewed and transplanted onto current `main` rather than blindly rebased. |
| Scope | Dependency scanning; secret scanning; SAST/CodeQL; pinned GitHub Actions where practical; CI failure artifacts; production-server health/readiness smoke; and meaningful runtime-role security validation. |
| Definition of Done | CI security checks run against the merged Security P0/runtime-role model, fail meaningfully on applicable findings, produce useful failure artifacts, and do not make misleading least-privilege claims merely because a privileged PostgreSQL connection uses `SET ROLE`. |
| Required Validation | Security P0 merge; CI workflow validation; dependency, secret, SAST/CodeQL, health/readiness, and runtime-role checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | #49 |
| Merge SHA | `12106be` |
| Verification / Evidence | Implementation commits `4851d5c` and `4336328` were merged by PR #49 as `12106be`. Successful PR CI run evidence: quality, dependency audit, Secret scan, Semgrep SAST, and Runtime-role proof passed; CodeQL was skipped because repository code-scanning support is not enabled. The Runtime-role proof exercised the migrated application with `app_runtime` in CI, including application build/start, readiness, health, and proof artifact upload. Dependency audit remains the current dependency gate; Semgrep CE is the active SAST gate. |
| Remaining Follow-up | Provision GitHub Code Scanning/GHAS support and enable `CODEQL_ENABLED=true` before claiming CodeQL coverage; keep dependency audit as the current dependency gate until then. |

#### 4. Observability P0

| Field | Record |
| --- | --- |
| Workstream | Observability P0 |
| Phase | Phase 1 — Finish launch-blocking foundation |
| Status | **VERIFIED** |
| Owner / Agent | Codex |
| Branch | `codex/observability-p0-20260929` |
| Dependencies | Security P0 is verified. Observability changes overlap shared API, authentication, and command routes and should be coordinated against current `main`. |
| Scope | Request IDs; consistent propagation; centralized safe/redacted error logging; consistent API error handling; safe status/duration/error telemetry hooks; and removal or replacement of unsafe raw exception logging where appropriate. |
| Definition of Done | Shared observability behavior is implemented without leaking sensitive data, route errors are consistently handled, request correlation is preserved, and relevant validation/evidence is recorded through merge and required verification. |
| Required Validation | Review shared API/auth/command overlap; applicable format, lint, typecheck, build, unit/integration, security, and runtime checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | #68 |
| Merge SHA | `d4f6e15` |
| Verification / Evidence | Merged to canonical `main` by PR #68 at `d4f6e15`; implementation commit `e5e96b7`. Post-merge verification passed on the clean canonical checkout: lint, typecheck, full unit suite (53 files / 388 tests), focused observability tests (10 tests), production build, Playwright E2E (`--workers=1 --retries=0`, 25 passed / 5 authorized persistence skips), and `git diff --check`. Route/security review confirmed all 26 API route files use the shared wrapper, no route-level raw console logging remains, no package dependency was introduced, and no business/auth/authorization semantics were changed. Full `pnpm format:check` reported only the known generated `.vercel/project.json` issue; that file was not modified. PR #68 CI evidence passed for quality, dependency audit, secret scan, Semgrep CE SAST, runtime-role proof, Vercel deployment, and Vercel preview comments; CodeQL was skipped because repository code-scanning support remains unavailable. No vendor-specific observability platform decision is recorded or implied. |
| Remaining Follow-up | Dedicated local PostgreSQL integration remains environment-dependent because `DATABASE_URL` is not configured; no integration evidence is claimed. Before pilot sign-off, connect deployed structured logs to the approved sink, dashboards, alerts, retention, and named on-call/escalation ownership described in [`runbooks/observability.md`](runbooks/observability.md), without implying a vendor selection. |

#### 5. Product Shell

| Field | Record |
| --- | --- |
| Workstream | Product Shell |
| Phase | Phase 2 — Product shell |
| Status | **VERIFIED** |
| Owner / Agent | Claude |
| Branch | `ui/product-shell-20260929` |
| Dependencies | Design System Foundation is verified. |
| Scope | Grouped collapsible desktop sidebar; mobile navigation; responsive page shell; header/top-level controls; theme control; Needs Attention notification pattern; global loading/error/WIP states; responsive layout behavior; and subtle premium motion. |
| Definition of Done | The permanent reusable shell is composed from the approved design-system foundations, works intentionally across supported screen sizes and themes, and includes the shared state patterns without becoming a temporary or one-off redesign. |
| Required Validation | Responsive and device/browser checks; light/dark checks; accessibility checks; applicable format, lint, typecheck, build, unit/E2E checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | #71 |
| Merge SHA | `d3721d37f1761c9c112210d0273f087c66930800` |
| Verification / Evidence | Implementation commit `ea6cde0` was merged by PR #71 as `d3721d37f1761c9c112210d0273f087c66930800`. PR checks finished with 7 successful, 0 failing and 0 pending; CodeQL remained skipped because repository code-scanning support is unavailable. Post-merge verification on canonical `main` at `d3721d3`: lint and typecheck passed; 54 test files / 412 tests passed; the production build passed; the theme-persistence E2E passed 5/5 targeted repetitions; the complete Product Shell E2E passed 11/11 with `--workers=1 --retries=0`; merged-diff whitespace and formatting checks passed; and the worktree remained clean. One earlier post-merge full E2E run observed a transient duplicate `.app-shell` hydration assertion and finished 10/11; five targeted repetitions and the immediate complete rerun did not reproduce it. **Implemented:** rebuilt `AppShell` behind its existing props API (no route files moved), with a persistent desktop sidebar (≥ 64rem) grouped as Today, Operations (Daily operations, Reconciliations, Inventory), Finance (Cash and banking, Provider settlements), Customers, Suppliers, Reports and Settings. Multi-destination groups collapse with `aria-expanded`/`aria-controls`. The sidebar collapses to an icon rail with hover/focus labels; rail and closed groups persist per device, and the rail is applied before first paint. Tablet and phone (< 64rem) get a slim sticky top bar whose menu opens the same navigation in a new `Modal` `drawer` presentation; the old bottom bar and 2×2 mobile context block were removed. Current route is marked with `aria-current="page"`. Customers and Settings open the standard `WorkInProgressDialog`; station-scoped areas explain station selection until a station is in the URL. Navigation forwards `tenantId`, `legalEntityId` and `stationId` from the URL (presentation only; pages re-validate). Also added: a `ThemeControl` segmented radio group (System default, Light, Dark; existing no-flash theme runtime unchanged); a one-line work context under breadcrumbs; an optional server-fed `attention` prop with a compact Needs Attention entry and panel (no page supplies data yet); shell-wrapped `error.tsx`, `not-found.tsx` and segment `loading.tsx` states; `headingLevel` on block `ErrorState`/`EmptyState`; and a sign-in frame with tablet gutters. Foundation follow-ups resolved: font set to the native system stack (Inter had been named but never loaded); the three legacy aliases used only by the old shell were removed; the mobile short-page shell was fixed; login tablet margins were fixed. **Validation:** Prettier check passed; lint passed; typecheck passed; unit tests 54 files / 412 tests passed (new `shell-preferences.test.ts`; `navigation.test.ts` rewritten); production build passed; serial E2E `--workers=1 --retries=0` 36 passed / 5 skipped (DB-backed specs, skipped without a test database), including new `product-shell.spec.ts` (11 tests: grouping, current route, group collapse, rail persistence, WIP, station context, theme override, phone drawer keyboard/focus, not-found, and axe on rail, dark theme, drawer and sign-in) and a narrowed `smoke.spec.ts` mobile test. `git diff --check` passed. **Manual review:** screenshots at 390, 820, 1024, 1280, 1440 and 1920 px in light and dark themes of sign-in, Today, Daily operations, Cash and banking, Suppliers, Reports, Inventory valuation, not-found, loading skeleton, WIP dialog, station dialog, drawer, icon rail and Needs Attention panel. |
| Remaining Follow-up | Product Shell implementation, PR/CI, merge and post-merge verification are complete. The remaining items below are follow-up integration or Golden Path / UX work and do not keep Product Shell open. **Codex:** (1) a server-side session/actor projection so the shell shows the real user, role, organisation, station and business date instead of each page's placeholder context strings; (2) the canonical permission → navigation-key projection (pages still pass `syntheticNavigationProjection`); (3) a station selector/context source so station-scoped navigation can link without a station in the URL; (4) a server-decided Needs Attention feed for the shell `attention` prop; (5) a sign-out entry once a session projection exists. **Golden Path / UX sweep:** Reports and other pages show missing context as a critical `ErrorState`, and Reports has an `h1` → `h3` heading-order skip; Suppliers and Settlements context panels are unstyled; `window.confirm` remains in `operations-control-room.tsx`, `daily-operations-workspace.tsx` and `production-reconciliation-workflow.tsx` and should move to `ConfirmDialog`; the Overview is still the foundation showcase. No toast primitive exists yet, so there is no shell toast region; add one with the toast API. **Direction note (release-owner decision, 2026-09-30):** the locked neutral Product Shell direction in this ledger remains canonical, and this Product Shell follows it. ADR-015 is retained as a superseded historical record; its glass/slate visual proposal and KPI-first Owner/Finance Overview are not part of the current product direction. |

#### 6. Golden Path UX

| Field | Record |
| --- | --- |
| Workstream | Golden Path UX |
| Phase | Phase 3 — Golden path |
| Status | **BLOCKED** |
| Owner / Agent | Claude — Agent 4 after the shell stabilizes |
| Branch | TBD |
| Dependencies | Design System Foundation and Product Shell. |
| Scope | `Login → Overview → Open Business Day → Forecourt → Reconciliation → Reports`. This is the highest client-facing UX priority. |
| Definition of Done | The complete golden path is obvious, fast, consistent, responsive, low-friction, visually premium, and validated across primary actions, operational states, loading/empty/error/WIP behavior, accessibility, and supported themes/devices. |
| Required Validation | Golden-path functional and UX checks; responsive/browser/device checks; light/dark checks; accessibility/usability checks; applicable format, lint, typecheck, build, unit/E2E checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Blocked pending the two named shared-foundation dependencies. No golden-path completion evidence is recorded. |
| Remaining Follow-up | Begin after the foundation and shell are stable, then prioritize client-ready polish before the long tail of secondary screens. |

#### 7. Remaining Product UI/UX Sweep

| Field | Record |
| --- | --- |
| Workstream | Remaining Product UI/UX Sweep |
| Phase | Phase 4 — Remaining product areas |
| Status | **BLOCKED** |
| Owner / Agent | Claude — TBD |
| Branch | TBD |
| Dependencies | Golden-path patterns and shared foundations must be stable first. |
| Scope | Customers; Suppliers; Cash; Settlements; Inventory; remaining Reports; Settings; administration; and other remaining product routes/modules. |
| Definition of Done | Remaining product areas use the shared approved patterns consistently, preserve client-visible product structure, and provide intentional loading, empty, error, and WIP states without inventing module-specific visual systems. |
| Required Validation | Per-route functional, responsive, accessibility, theme, and state checks; applicable format, lint, typecheck, build, unit/E2E checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Blocked pending stable golden-path patterns and shared foundations. No completion evidence is recorded. |
| Remaining Follow-up | Do not parallelize module UI work until reusable design patterns are stable and ownership/merge order are recorded. |

#### 8. Client-Ready Staging

| Field | Record |
| --- | --- |
| Workstream | Client-Ready Staging |
| Phase | Phase 5 — Client-ready staging and production rehearsal |
| Status | **BLOCKED** |
| Owner / Agent | Codex + Claude — split technical/UX ownership; coordinator TBD |
| Branch | TBD |
| Dependencies | Cross-module staging access and synthetic-data operator; a usable golden path; responsive, light/dark, accessibility, usability, browser/device, performance, navigation, and state QA; and the open release gates recorded below. |
| Scope | A polished client-facing staging environment with realistic data, a usable golden path, responsive behavior, light/dark behavior, consistent WIP handling, no obvious broken interactions, accessibility/usability validation, and enough stability for meaningful client review. |
| Definition of Done | The target staging experience is evidenced as polished and reviewable across the defined scope. Client-ready staging is explicitly **not** equivalent to production readiness. |
| Required Validation | Cross-module staging journeys; responsive QA; light/dark QA; accessibility QA; browser/device QA; performance checks; usability pass; navigation consistency; loading/empty/error-state checks; and links to relevant security, recovery, observability, and incident evidence. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Existing evidence supports authenticated staging smoke, deployed-staging tenant-isolation/RLS verification, and the exercised database/application/R2 recovery scope. It does not prove a polished client-ready staging environment. The authenticated staging gate and cross-module journeys remain deferred in the existing ledger. |
| Remaining Follow-up | Resolve staging access and operator prerequisites; complete the cross-module and client-review scope; record evidence; and keep this gate separate from production readiness. |

#### 9. Production Rehearsal / Final Launch Gate

| Field | Record |
| --- | --- |
| Workstream | Production Rehearsal / Final Launch Gate |
| Phase | Phase 5 — Client-ready staging and production rehearsal |
| Status | **BLOCKED** |
| Owner / Agent | Codex — TBD |
| Branch | TBD |
| Dependencies | Security, integrity, observability, alerts, operational ownership, recovery, rollback, production configuration, smoke tests, and the cutover checklist. |
| Scope | Production configuration validation; security gates; integrity gates; observability and alerting gates; backup/recovery gates; rollback verification; production smoke rehearsal; operational ownership/runbooks; and the controlled launch checklist. |
| Definition of Done | Every required rehearsal and final-launch gate has a named owner, passed evidence, an operational response path, and no unresolved launch-blocking gap. |
| Required Validation | All applicable production/rehearsal checks, including the release gates and runbooks below, with evidence linked in this document or its referenced artifacts. |
| PR | #73 |
| Merge SHA | `70e80925f7660bcec1abc5e24202dd2d679c27a0` |
| Verification / Evidence | The production-safe read-only smoke harness implementation is **VERIFIED after merge** under `src/platform/smoke/read-only.ts`, with the operator entry point `scripts/production-readonly-smoke.ts`. Post-merge evidence from canonical `main` at `70e80925f7660bcec1abc5e24202dd2d679c27a0`: Prettier passed on affected files; typecheck passed; focused `src/platform/smoke/read-only.test.ts` passed 19/19; the production build passed with 34/34 pages; `git diff --check` passed; and the worktree was clean. No staging, production, or provider execution has been performed. Existing ledger evidence still records open performance execution, monitoring/alert integration, key rotation, tenant-scoped recovery, onboarding, and other release follow-ups. RPO/RTO planning targets remain unproven as recorded below. |
| Remaining Follow-up | Execute the harness only against an approved current staging deployment, then later under explicit production approval with a securely supplied Better Auth session cookie. Close or explicitly disposition each security, integrity, observability, alerting, ownership, recovery, rollback, configuration, smoke, and cutover item before advancing this status. |

#### 10. Controlled Real Production Launch

| Field | Record |
| --- | --- |
| Workstream | Controlled Real Production Launch |
| Phase | Phase 6 — Controlled real production launch |
| Status | **BLOCKED** |
| Owner / Agent | Codex — TBD; Claude supplies UX/accessibility evidence |
| Branch | TBD |
| Dependencies | All launch-blocking security, integrity, recovery, and operational gates must be closed and verified. |
| Scope | A controlled and monitored initial production release. |
| Definition of Done | The fixed finish line is satisfied: “Controlled real production launch with no launch-blocking security, integrity, recovery, or operational gaps.” |
| Required Validation | Final launch checklist; closed and verified blocking gates; production configuration validation; production smoke tests; rollback readiness; monitoring/alert routing; operational ownership; and controlled-launch evidence. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Not complete. The existing release ledger contains open follow-ups and explicitly does not establish production readiness. |
| Remaining Follow-up | Do not launch or mark this workstream complete until every blocking gate is closed and the evidence is recorded. |

### Locked Agent Ownership Model

This Codex/Claude ownership split is **LOCKED** unless the product owner
explicitly changes it. It exists to prevent duplicate work, UI/backend overlap,
conflicting implementations, unpredictable handoffs, merge conflicts, and
unclear responsibility for each type of work.

#### Codex owns

Codex is the primary owner for all non-visual implementation work, including:

- Security P0;
- CI/security hardening;
- observability;
- database work and migrations;
- RLS/security grants;
- authentication internals and authorization;
- API behavior and backend business logic;
- data integrity;
- recovery and backup/restore work;
- operational tooling;
- production readiness;
- provider configuration where appropriate;
- infrastructure-related work;
- tests and integration tests;
- validation and build/quality gates;
- production rehearsal;
- rollback/cutover work;
- runbooks;
- release-readiness documentation;
- execution ledger updates; and
- non-visual infrastructure.

Codex must **not** independently redesign the UI/UX. Codex may make minimal
UI-adjacent changes only when strictly necessary to support backend correctness,
security, data flow, accessibility infrastructure, or required integration
contracts. If a change meaningfully affects visual behavior or product
interaction, hand it to Claude.

#### Claude owns

Claude is the primary owner for all visual/product-experience implementation,
including:

- design-system implementation;
- typography, spacing, visual hierarchy, surfaces, and cards;
- light mode, dark mode, and theme behavior;
- the app shell and navigation;
- the collapsible sidebar and mobile navigation;
- responsive behavior and layout composition;
- visual states;
- forms presentation and interaction polish;
- tables, charts, graphs, and notifications;
- “Needs attention” presentation;
- dialogs/modals and confirmation flows;
- loading states, skeletons, empty states, error states, and WIP states;
- motion and micro-interactions;
- accessibility presentation;
- golden-path UX;
- remaining screen revamps;
- visual consistency; and
- mobile, tablet, and desktop experience.

Claude must **not** independently change database behavior, migrations,
permissions, security controls, authentication internals, API contracts,
business logic, financial rules, recovery behavior, infrastructure, or
production configuration.

#### Cross-boundary rule

If Claude discovers that a UI/UX task requires a backend, API, security, or
data-model change:

1. Claude documents the required backend change.
2. Claude stops short of implementing that backend change unless explicitly
   authorized.
3. Claude hands the backend requirement to Codex.
4. Codex implements and validates the backend change.
5. Claude integrates the completed backend contract into the UI.

If Codex discovers that a backend change requires a meaningful UI/UX change:

1. Codex implements the backend contract only.
2. Codex documents the UI impact.
3. Claude owns the resulting visual and interaction implementation.

#### Shared file rule

Some files may be technically touched by both agents but must have only one
active owner at a time. Examples include:

- shared layout files;
- global CSS;
- theme infrastructure;
- auth-facing routes/components;
- shared error presentation;
- the app shell;
- the shared component library; and
- route files containing both data and presentation logic.

Before either agent modifies a shared file, check this execution ledger,
confirm ownership, confirm branch and merge order, and avoid parallel edits to
the same shared foundation.

If overlap cannot be avoided, backend/security changes land first where
correctness depends on them, Claude adapts the UI afterward, and conflicting
implementations are not blindly merged.

#### Golden path ownership

Claude owns the visual and interaction implementation for:

`Login → Overview → Open Business Day → Forecourt → Reconciliation → Reports`

Codex owns the underlying APIs, permissions, security, data behavior, business
rules, integrity constraints, and backend validation.

### Parallel execution model

The approved execution model allows a maximum of **4 active implementation
agents**, but four agents must not be started automatically. The immediate
active target is **2 agents**.

Current intended sequencing:

**Now**

- Codex / Agent 1: Security P0
- Claude / Agent 2: Design System Foundation

**After Security P0 merges**

- Codex / Agent 1 or replacement: CI Security Hardening
- Codex / Agent 3: Observability P0
- Claude / Agent 2: Design System Foundation → Product Shell

**After the design system and shell are stable**

- Claude / Agent 4: Golden Path UX

Then:

- Claude: Remaining Product UI/UX Sweep
- Codex: remaining operational, security, and recovery launch gates

Later, parallelize remaining module UI work only after the reusable design
patterns are stable. Do not automatically consume all four active-agent slots.

Final convergence requires:

- Codex: backend, security, and operations verification;
- Claude: UI/UX, responsive, and accessibility verification; and
- both agents: feed their evidence into this canonical readiness ledger.

### Shared file ownership rule

Shared foundational areas must have one active owner at a time. Examples are:

- global CSS;
- theme infrastructure;
- navigation shell;
- shared design-system primitives;
- authentication;
- environment configuration;
- migrations;
- common error handling;
- observability infrastructure; and
- shared security primitives.

Multiple agents must not independently redesign or substantially modify the
same shared foundation simultaneously.

If overlap is unavoidable, identify it before implementation, define the merge
order, assign one owner of the shared file, and require later agents to adapt
on top of the merged implementation.

### Branch and integration rules

Each implementation must begin from current canonical `main` unless it is an
explicitly reviewed transplant.

For stale agent worktrees:

- preserve existing work;
- do not blindly rebase dirty worktrees;
- review the actual diff; and
- transplant or adapt onto a fresh branch when that is safer.

Do not use force push or history rewriting as the normal workflow.

The canonical integration sequence is:

`inspect → implement → validate → review actual diff → stage → review staged diff → commit → push → PR → CI/checks → merge → update main → verify → update ledger`

### Definition of Done rule

A workstream cannot move to **READY FOR REVIEW** until:

- scoped implementation is complete;
- no known unintended changes remain;
- relevant tests pass;
- formatting, lint, typecheck, and build gates pass where applicable;
- the diff has been reviewed;
- known security and integrity implications are understood; and
- documentation and evidence are updated if required.

A workstream cannot move to **MERGED** until its PR has merged and the merge
SHA is recorded.

A workstream cannot move to **VERIFIED** until required runtime, staging,
provider, or post-merge verification has passed and the evidence is recorded.

Ownership does not override any validation requirement. A workstream is not
complete merely because its owning agent says it is complete.

For Claude-owned UI work, the Definition of Done includes, where applicable:

- responsive behavior;
- light/dark mode;
- loading, empty, and error states;
- WIP state;
- accessibility;
- no obvious visual regression;
- consistency with the locked design system;
- relevant functional tests; and
- staging review where appropriate.

For Codex-owned work, the existing technical, security, integration, runtime,
recovery, and release validation requirements continue to apply.

### Mandatory ledger update rule

Every developer or coding agent working on a tracked launch workstream must
update this ledger when the work materially changes state, including:

- **NOT STARTED → IN PROGRESS**;
- **IN PROGRESS → BLOCKED**;
- **IN PROGRESS → READY FOR REVIEW**;
- **READY FOR REVIEW → MERGED**; and
- **MERGED → VERIFIED**.

When merging, record the PR number or link if available, implementation commit
if relevant, merge SHA, validation summary, and remaining follow-up.

The ledger must never knowingly claim a more advanced state than the evidence
supports.

### Session handoff rule

Before another developer or agent takes over a workstream, the ledger must make
clear the current status, branch, exact completed scope, exact remaining scope,
known risks, validation already completed, and next action. A new agent should
be able to continue without requiring the product owner to re-explain the
project.

For cross-agent dependencies, record the following handoff format in this
execution ledger or in adjacent handoff notes:

- Requesting agent
- Owning agent
- Required change
- Reason
- Files/contracts affected
- Blocking or non-blocking
- Required validation
- Status

### Ownership source-of-truth rule

This section remains the supporting ownership record for launch-related work.
Future Codex or Claude sessions should read it before starting such work. The
ownership rules in this section do not override the canonical knowledge base.
If the product owner explicitly changes ownership later, update this record and
the appropriate canonical document when the change is material.

### Non-negotiable preservation rules

Do not:

- remove existing evidence;
- alter existing recovery conclusions;
- claim RPO/RTO targets were demonstrated when they were not;
- declare production-ready;
- mark incomplete work complete;
- rewrite historical migrations;
- change application code;
- change the locked UX/product direction; or
- renumber phases unless strictly necessary.

## Gate status

| Gate | Status | Evidence or owner action |
| --- | --- | --- |
| Merged implementation baseline | **RECORDED** | `docs/CURRENT_STATUS.md`; R2 recovery implementation baseline `fc10d01`. |
| Repository quality gate | **PASS for RC** | [CI run 38353115180](https://github.com/hrshanda56-beep/shanda-fuel/actions/runs/38353115180) on `dadd9cd2f6efabcec30e36b939b6cdd84c0e4bcf` passed all required enabled jobs; CodeQL was skipped. |
| Authenticated staging smoke | **COMPLETE / PASSED** | Completed authenticated staging operator flow using the normal sign-in path and the approved staging procedure. |
| Cross-module staging journeys | **DEFERRED** | Exercise station/day/shift, reconciliation approval, inventory/costing evidence, cash/provider distinction, reporting, and permission-denial paths with synthetic data. |
| Tenant-isolation verification on deployed staging | **COMPLETE / PASSED** | Completed deployed-staging tenant-isolation and RLS verification. |
| Backup/restore drill | **DATABASE, APP, AND R2 RECOVERY VERIFIED** | Lane 4 isolated PITR restore, restored-DB integrity/security validation, isolated application readiness, and provider-configured R2 deleted-object recovery are complete for the exercised staging scope. RPO/RTO planning targets remain unproven. |
| PostgreSQL 18 logical backup/restore for Milestone A | **OPEN / NOT EVIDENCED** | No PostgreSQL 18 custom-format dump, secure archive URI/checksum, and isolated logical restore record is present. Use the owner procedure in `docs/runbooks/milestone-a-release.md`; do not treat the Lane 4 PITR drill as this gate. |
| R2 deleted-object recovery | **COMPLETE / PASSED** | Separate private recovery bucket, 30-day Bucket Lock and lifecycle controls, recovery credentials, witnessed synthetic delete/restore drill, checksum verification, retained artifacts, and primary cleanup are evidenced. Production retention remains a separate owner/accounting decision. |
| Performance verification | **PROCEDURE READY; EXECUTION OPEN** | Follow [`staging-performance-verification.md`](runbooks/staging-performance-verification.md) and record p50/p95 results against Blueprint planning goals. |
| Monitoring and alert routing | **EXPECTATIONS RECORDED; INTEGRATION OPEN** | Follow [`observability.md`](runbooks/observability.md); connect the deployed platform to the approved log/alert destination. |
| Incident and app rollback path | **DOCUMENTED** | [`incident-response.md`](runbooks/incident-response.md) and [`deployment.md`](runbooks/deployment.md). Provider-specific console access remains an owner prerequisite. |
| Key rotation | **OPEN FOLLOW-UP** | [`key-rotation.md`](runbooks/key-rotation.md) needs provider-specific rotation and verification evidence. |
| Tenant-scoped recovery | **OPEN FOLLOW-UP** | [`tenant-recovery.md`](runbooks/tenant-recovery.md) needs an approved isolated-restore/extract/repair exercise. |
| Client/accounting/onboarding inputs | **EXTERNAL GATE** | Use the existing onboarding workbook and the confirmation register in the Blueprint; do not invent values. |

## Lane 4 recovery evidence

| Check | Result |
| --- | --- |
| Database PITR isolated restore drill | **COMPLETE** — temporary Neon recovery branch `lane4-restore-drill-20260928` remains available and auto-expires after one day. |
| Restored DB integrity/security validation | **COMPLETE** — independently validated through Neon SQL Editor, including migrations, hierarchy, permissions, lineage, audit evidence, RLS/policies, and checksums. |
| Local app process startup | **VERIFIED** — a local Next.js instance started against the recovery-branch `DATABASE_URL`; the earlier local readiness result was not classified as a restored-database failure. |
| Isolated application verification | **VERIFIED** — temporary Vercel Preview deployment `dpl_Ejf2DLRpiuQUnqg87FXwnvnhyLqY` of source commit `7ba5e683f751f92fbb39755f7d322bfdcc10a8e3` used the recovery-branch `DATABASE_URL`. |
| `/api/health` | **HTTP 200** with application `ok`. |
| `/api/readiness` | **HTTP 200** with database `ok`. |
| App-to-restored-DB readiness | **VERIFIED** by the isolated Vercel Preview deployment. |
| Side-effect scope | No auth, POST, financial, R2, email, cron, migration, smoke, or other write-capable route was invoked. The temporary Vercel project and its deployments were deleted afterward. |
| Staging R2 deployment | **VERIFIED** — production-target staging deployment `dpl_4p5rQvNKxP7hzS8BXtNjpbj1AxpP` from canonical commit `fc10d0112b1e504a58f241326167edec934571cc`; `/api/health` and `/api/readiness` both returned HTTP 200 before the drill. |
| R2 provider configuration | **VERIFIED** — primary `shanda-fuel-staging-private`; separate private recovery bucket `shanda-fuel-staging-recovery`; 30-day Bucket Lock on `recovery/v1/objects/` and `recovery/v1/manifests/`; 30-day lifecycle expiry on `recovery/v1/`; public access disabled. |
| R2 deleted-object recovery drill | **COMPLETE / PASSED** — exit code 0; backup `a8e1cd42-cd34-4f73-a837-1710648d3c7e`; SHA-256 `146f8cd7a6a4435906f62232c7ee4586a0889181bd6424fe49d45f2f3264a2d7`; retained-copy creation, guarded delete, restore, and restored-byte checksum verification passed. |
| R2 retained evidence and cleanup | **VERIFIED** — retained object (59 B, `text/plain`) and manifest (685 B, `application/json`) remained present after the drill; synthetic primary object was deleted; temporary primary-drill credential was revoked; recovery application credential remained active. |
| RPO ≤15 minutes | **NOT DEMONSTRATED BY THIS DRILL**. |
| Full RTO ≤4 hours | **NOT DEMONSTRATED**. |

This evidence establishes isolated application connectivity to the recovered
database plus provider-configured R2 deleted-object recovery. Lane 4 recovery
is complete for the exercised database/application/R2 scope. RPO ≤15 minutes
and RTO ≤4 hours remain unproven; tenant-scoped recovery and broader incident
exercises remain separate gates.

## Deferred authenticated staging gate

The gate is deferred because this repository task has no staging deployment
credentials, staging URL, provider console access, or approved synthetic-data
operator. That is an external execution dependency, not permission to weaken
authentication or seed production.

When access is granted, record one evidence bundle containing:

- deployment identifier, commit, environment, operator, UTC start/end times;
- check-only and bootstrap output from the staging auth runbook, without
  passwords, cookies, tokens, or sensitive identifiers;
- normal HTTPS sign-in evidence, including the configured authenticated setup
  and step-up/MFA paths as deployed;
- successful `OpenBusinessDay` and `StartShift` smoke results, followed by
  proof that temporary grants expire;
- platform storage/email smoke results when those adapters are configured;
- cross-module workflow, tenant-isolation, permission-denial, and error-state
  results; and
- links to performance, restore, logs, and incident-test evidence.

Do not create financial data in the auth-bootstrap smoke unless the staging
test plan explicitly expands the scope and names the cleanup owner.

## Known post-release follow-ups

These are not silently converted into implementation work by the RC:

1. Connect production-grade structured log collection, dashboards, alert
   routing, retention, and on-call ownership.
2. Keep production R2 retention, credential ownership, and recovery-operator
   approval as explicit deployment-owner decisions. The witnessed staging drill
   does not establish production retention or prove the RPO/RTO planning targets.
3. Complete the staging performance run with representative synthetic data and
   investigate any regression before pilot.
4. Complete key rotation and tenant-scoped recovery exercises with provider
   owners.
5. Decide, with signed scope, which deferred domain capabilities are required:
   expenses, exports/artifacts, full profitability, customer commercial policy,
   inventory transfer/calibration, offline synchronization, and external APIs.
6. Capture pilot station/master data, opening positions, accountant/tax
   decisions, training/UAT evidence, shadow-operation results, and pilot exit
   approval.

## Release-blocker reconciliation

There is no repository-only blocker preventing this documentation slice from
being completed. The following are genuine gates for the next environment:

- inability to establish the separate database role topology before deployment;
- missing staging access for the authenticated verification;
- failure of tenant-isolation/security checks or critical financial workflow
  tests;
- no recoverable backup or failed restore drill;
- an unreviewed performance or availability regression; or
- missing client/accounting approval for a required pilot behavior.

Unknown station, bank, tank, supplier, customer, threshold, and opening-position
values remain onboarding/cutover inputs, not software-development blockers.
