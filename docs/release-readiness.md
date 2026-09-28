# Release readiness ledger

**Validated application baseline:** `7ba5e68`
**Last reconciled:** 2026-09-28
**Classification:** operational release record; it does not change domain, accounting, authentication, MFA, RLS, authorization, migration, reporting, or settlement behavior.

## Controlled Production Launch Plan — Locked Product & UX Direction

This section is locked product and launch direction. It is not an implementation
status claim and does not replace the evidence or gate statuses below.

`docs/release-readiness.md` is the canonical source of truth for launch
execution and product-experience decisions. Future developers and coding agents
must read this section before redesigning navigation, creating a new visual
pattern, redesigning a route or page, changing the theme system, implementing
work-in-progress behavior, changing the golden-path UX, or making a
launch-readiness decision.

If a future implementation conflicts with this section, this document wins
unless the product owner explicitly changes the locked decision. Any material
change must be recorded clearly; no implementation status may be inferred from
the plan alone.

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

This document is the canonical source of truth for controlled production launch
readiness, locked product/UX direction, execution phases, active implementation
work, dependencies, completion state, verification evidence, and remaining
launch blockers. Future developers and coding agents **must** read it before
starting launch-related work.

If an agent's assumptions conflict with this document, this document wins
unless the product owner explicitly changes the decision. This ledger records
execution control only; it does not replace the locked UX direction, the
existing release gates, or the evidence and conclusions recorded below.

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

| Workstream | Phase | Status | Owner / Agent | Branch | Dependencies | PR | Merge SHA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Security P0 | Phase 1 | **READY FOR REVIEW** | Codex — Agent 1 (security owner) | `hardening/security-p0-v2` | None recorded | TBD | TBD |
| Design System Foundation | Phase 1 | **NOT STARTED** | Claude — Agent 2 (design-system owner) | TBD | None requiring wait | TBD | TBD |
| CI Security Hardening | Phase 1 | **BLOCKED** | Codex — TBD | TBD | Security P0 must merge | TBD | TBD |
| Observability P0 | Phase 1 | **BLOCKED** | Codex — Agent 3 after Security P0 merge | TBD | Security P0 should merge first | TBD | TBD |
| Product Shell | Phase 2 | **BLOCKED** | Claude — Agent 2 after foundation stabilizes | TBD | Design System Foundation | TBD | TBD |
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
| Status | **READY FOR REVIEW** |
| Owner / Agent | Codex — Agent 1 (security owner) |
| Branch | `hardening/security-p0-v2` |
| Dependencies | None recorded for starting this workstream. |
| Scope | Production audit-signing fail-closed behavior; explicit `APP_ENV` handling compatible with staging; tenant-bound privileged step-up/MFA authorization; security response headers; forward-only migration `0019` removing inappropriate auth-schema access from non-auth runtime roles; regression tests; preserve historical migrations unchanged. |
| Definition of Done | Complete the scoped Security P0 implementation, preserve migration `0002`, pass all required validation, complete diff/staged-diff review, and carry the work through PR, CI, merge, and required post-merge verification. Do not claim full runtime-role least privilege from this patch. |
| Required Validation | Fresh disposable PostgreSQL bootstrap; migrations through `0019`; `db check`; integration tests; direct privilege verification; final diff review; staging; staged diff review; commit; push; PR; CI; merge; and post-merge verification as required. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Implementation commit `58ddf9a`. Fresh PostgreSQL 16 bootstrap passed; canonical `pnpm db:migrate:test` passed; migrations `0000`–`0019` applied with 20 migration records; `pnpm db:check` passed; integration tests passed (16 files / 94 tests); unit tests passed (46 files / 289 tests); Prettier, ESLint, typecheck, production build, and `git diff --check` passed; direct privilege verification confirmed 10/10 checks with no auth schema USAGE or SELECT access for `job_runtime` and `diagnostics_readonly`; migration `0002` unchanged; rejected process-local/in-memory rate limiter absent; staging remains supported through explicit `APP_ENV=staging`. |
| Remaining Follow-up | Stage/staged-diff review, then push; PR; CI; merge; and post-merge/runtime verification as required. Provider/durable rate limiting remains separate; broader `app_runtime` least-privilege work is not claimed complete. |

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
| Status | **NOT STARTED** |
| Owner / Agent | Claude — Agent 2 (design-system owner) |
| Branch | TBD |
| Dependencies | None requiring a wait for Security P0; this work may run in parallel with Security P0. |
| Scope | Design tokens; typography; spacing; layout/grid rules; color system; restrained Shanda Fuel brand accent; light theme; dark theme; system preference detection; manual theme override; surfaces/cards; buttons; inputs; form controls; tables; chart/visualization rules; notifications; dialogs/modals; confirmations; loading/skeleton states; empty states; error states; WIP treatment; responsive primitives; motion rules; and accessibility foundations. Scope must align with the locked UX/product plan above. |
| Definition of Done | Reusable product infrastructure is implemented and documented across the defined foundation areas. This is not a one-off page redesign. Required local validation and review are complete, and the implementation is ready for the integration sequence. |
| Required Validation | TBD; define and run the applicable formatting, lint, typecheck, build, accessibility, responsive, theme, and component-level validation before review. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | No implementation or completion evidence is recorded in this ledger. |
| Remaining Follow-up | Start from current canonical `main`, establish the reusable foundation, record the branch and validation evidence, then move through review, merge, and verification. |

#### 3. CI Security Hardening

| Field | Record |
| --- | --- |
| Workstream | CI Security Hardening |
| Phase | Phase 1 — Finish launch-blocking foundation |
| Status | **BLOCKED** |
| Owner / Agent | Codex — TBD |
| Branch | TBD |
| Dependencies | Security P0 must merge first so CI can validate the final security/runtime-role model. Existing agent work, if any, must be reviewed and transplanted onto current `main` rather than blindly rebased. |
| Scope | Dependency scanning; secret scanning; SAST/CodeQL; pinned GitHub Actions where practical; CI failure artifacts; production-server health/readiness smoke; and meaningful runtime-role security validation. |
| Definition of Done | CI security checks run against the merged Security P0/runtime-role model, fail meaningfully on applicable findings, produce useful failure artifacts, and do not make misleading least-privilege claims merely because a privileged PostgreSQL connection uses `SET ROLE`. |
| Required Validation | Security P0 merge; CI workflow validation; dependency, secret, SAST/CodeQL, health/readiness, and runtime-role checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Blocked pending the named Security P0 dependency. No completion evidence is recorded. |
| Remaining Follow-up | Review any existing agent work against current `main`, define ownership and branch, implement after Security P0 merges, and record honest runtime-role findings. |

#### 4. Observability P0

| Field | Record |
| --- | --- |
| Workstream | Observability P0 |
| Phase | Phase 1 — Finish launch-blocking foundation |
| Status | **BLOCKED** |
| Owner / Agent | Codex — Agent 3 after Security P0 merge |
| Branch | TBD |
| Dependencies | Security P0 should merge first because observability changes overlap shared API, authentication, and command routes. |
| Scope | Request IDs; consistent propagation; centralized safe/redacted error logging; consistent API error handling; safe status/duration/error telemetry hooks; and removal or replacement of unsafe raw exception logging where appropriate. |
| Definition of Done | Shared observability behavior is implemented without leaking sensitive data, route errors are consistently handled, request correlation is preserved, and relevant validation/evidence is recorded through merge and required verification. |
| Required Validation | Review shared API/auth/command overlap; applicable format, lint, typecheck, build, unit/integration, security, and runtime checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Blocked pending the named Security P0 dependency. No vendor-specific observability platform decision is recorded or implied. |
| Remaining Follow-up | Resolve the dependency, assign a concrete branch and owner, implement safe/redacted telemetry, and record evidence without inventing a vendor decision. |

#### 5. Product Shell

| Field | Record |
| --- | --- |
| Workstream | Product Shell |
| Phase | Phase 2 — Product shell |
| Status | **BLOCKED** |
| Owner / Agent | Claude — Agent 2 after the foundation stabilizes |
| Branch | TBD |
| Dependencies | Design System Foundation must be sufficiently stable first. |
| Scope | Grouped collapsible desktop sidebar; mobile navigation; responsive page shell; header/top-level controls; theme control; Needs Attention notification pattern; global loading/error/WIP states; responsive layout behavior; and subtle premium motion. |
| Definition of Done | The permanent reusable shell is composed from the approved design-system foundations, works intentionally across supported screen sizes and themes, and includes the shared state patterns without becoming a temporary or one-off redesign. |
| Required Validation | Responsive and device/browser checks; light/dark checks; accessibility checks; applicable format, lint, typecheck, build, unit/E2E checks; final diff/staged-diff review; PR/CI; merge; and required post-merge verification. |
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Blocked pending foundation stability. No shell completion evidence is recorded. |
| Remaining Follow-up | Do not begin substantial shared-shell work until the Design System Foundation is sufficiently stable; record the owner and branch before implementation. |

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
| PR | TBD |
| Merge SHA | TBD |
| Verification / Evidence | Existing ledger records open performance execution, monitoring/alert integration, key rotation, tenant-scoped recovery, onboarding, and other release follow-ups. RPO/RTO planning targets remain unproven as recorded below. |
| Remaining Follow-up | Close or explicitly disposition each security, integrity, observability, alerting, ownership, recovery, rollback, configuration, smoke, and cutover item before advancing this status. |

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

`docs/release-readiness.md` remains the canonical source of truth. Future Codex
or Claude sessions must read it before starting work. The ownership rules in
this section override an agent's assumptions about who should implement
something. If the product owner explicitly changes ownership later, update
this document first.

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
| Merged implementation baseline | **RECORDED** | `docs/implementation-status.md`; R2 recovery implementation baseline `fc10d01`. |
| Repository quality gate | **DEFINED** | `.github/workflows/ci.yml`; attach the CI run for the RC commit. |
| Authenticated staging smoke | **COMPLETE / PASSED** | Completed authenticated staging operator flow using the normal sign-in path and the approved staging procedure. |
| Cross-module staging journeys | **DEFERRED** | Exercise station/day/shift, reconciliation approval, inventory/costing evidence, cash/provider distinction, reporting, and permission-denial paths with synthetic data. |
| Tenant-isolation verification on deployed staging | **COMPLETE / PASSED** | Completed deployed-staging tenant-isolation and RLS verification. |
| Backup/restore drill | **DATABASE, APP, AND R2 RECOVERY VERIFIED** | Lane 4 isolated PITR restore, restored-DB integrity/security validation, isolated application readiness, and provider-configured R2 deleted-object recovery are complete for the exercised staging scope. RPO/RTO planning targets remain unproven. |
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
