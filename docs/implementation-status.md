# Implementation status

Status: **A3 CORE FORECOURT SLICE IMPLEMENTED WITH SECURITY/INTEGRATION REMEDIATION — INTEGRATION REVIEW PENDING**

## Current integration base

`7260fa2cc8aa63f11728fd1cb37b8b15fd7b52bb` (`origin/main`, approved A1 integration baseline)

A1 branch: `agent/a1-platform-security` in the isolated worktree `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a1`, PR [#2](https://github.com/hrshanda56-beep/shanda-fuel/pull/2), approved and merged into `main` at `7260fa2cc8aa63f11728fd1cb37b8b15fd7b52bb`. Canonical migrations `0001` and `0002` are present and verified; the architecture SQL proposal remains reference-only. A0 integration verification and the fresh PostgreSQL CI path passed.

The approved A1 foundation adds the trusted tenant-authority path, server-side Better Auth actor resolution, fail-closed strong-auth and origin validation, tenant-scoped append-only security events, canonical migrations `0001`/`0002`, executable role bootstrap, and real PostgreSQL negative tests. A0's approved dependency compatibility decision is applied with Better Auth 1.7.5, Drizzle ORM ^0.45.2, and Drizzle Kit ^0.31.7. The merged foundation retains the fresh PostgreSQL migration, role bootstrap, Better Auth, RLS, and privilege validation path.

## A2 — UI foundation

Workstream branch: `agent/a2-ui-foundation` in `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a2`, based on required integration baseline `cd63d48b7a142905722d7c9ec76da053c29fbbb4`, now integrating approved `origin/main` at `7260fa2cc8aa63f11728fd1cb37b8b15fd7b52bb`.

- [x] Semantic light/dark/system tokens, typography, spacing, focus, reduced-motion, and tabular-number conventions.
- [x] Responsive AppShell with context surface, breadcrumbs, desktop sidebar, and Home / Tasks / Work / More mobile navigation seam.
- [x] Permission-projection navigation filter that does not authorize commands in the browser.
- [x] Reusable controls, forms, numeric/date presentation formatters, status badges, responsive table/card patterns, evidence, risk-confirmation, and truthful loading/empty/error/conflict/offline/permission/not-found states.
- [x] Synthetic representative dashboard/form/state surfaces with unit, Playwright, and axe coverage.

A2 remains presentation-only. A1 supplies live actor/permission contracts; A0/integration owns shared tooling and platform wiring. No database, persistence, financial calculation, business command, authentication, or RLS work is included here.

Remediation for PR #3: mobile operating context now includes an accessible optional shift slot; dialog/bottom-sheet primitives manage focus, Escape, inert background, and restoration; mobile navigation uses valid list semantics; required controls use native/ARIA required state; AppShell consumes typed `NavigationProjection` keys rather than raw permission identifiers; BusinessDate formatting is timezone-invariant; theme-sensitive values use semantic tokens; and shared Buttons default safely to `type="button"`.

## Phase 0 — Repository & Engineering Foundation

- [x] A0 establishes the technical baseline and pinned compatible toolchain.
- [x] Shared lint, format, typecheck, unit, integration, E2E, accessibility, and CI gates exist.
- [x] Drizzle/PostgreSQL development and migration workflow is established.
- [x] Environment validation and secret-safe configuration exist.
- [x] Modular monolith boundaries are implemented.

Remediation validation: the namespace migration was applied successfully to PostgreSQL 16 in a dedicated ephemeral test database; `pnpm test:integration` executed 2 real PostgreSQL assertions against it. Unit discovery is separate and does not include integration tests.

## Phase 1 — Tenancy, Identity, Authorization & Security

- [x] Authentication integration (canonical Better Auth schema, adapter persistence, session expiration, and actor-resolution path verified in CI).
- [x] Tenant, legal entity, station, membership, role, permission, and scope foundation (canonical `0002` migration and UUID membership identity compatibility verified in CI).
- [x] Tenant context, RLS, runtime role separation, audit/security foundation (canonical RLS/grants, append-only event privileges, and bootstrap verified in CI).
- [x] Automated tenant-isolation tests (real PostgreSQL CRUD, missing-context, composite-FK, role ownership, and privilege-negative coverage verified in CI).

## Phase 2 — Core Forecourt Vertical Slice

- [x] Framework-free business-day and shift state machines with explicit not-operated/exceptional exits.
- [x] Meter installation, effective boundaries/segments, attendant handover metadata, exact server-derived sales, and nozzle overlap constraints.
- [x] Payment declarations, signed variance calculation, immutable revision flow, return/approve/post/lock transitions, and typed downstream events.
- [x] Rebuildable basic daily report source contract and representative mobile-first operational surface.
- [x] A1-derived trusted command context, explicit station-scoped permissions, on-behalf-of provenance, transaction-bound idempotency/audit/outbox, station-aware composite FKs, immutable-state database guards, versioned reconciliation events, and event-contract tests.
- [ ] A0 integration of canonical migration and production command adapters; PostgreSQL integration/E2E gates require the isolated branch to be reviewed and merged through `main`.

## Phase 3 — Inventory, Tanks, Deliveries & Costing

- [ ] Tanks, calibration, dips, inventory pools, movements, deliveries, transfers, adjustments.
- [ ] Perpetual weighted-average costing and late-cost revaluation.

## Phase 4 — Cash, Banking & Electronic Settlements

- [ ] Cash custody, counts, handovers, disputes, collections, deposits, provider batches, settlements, and bank confirmation.

## Phase 5 — Suppliers, Customers & Expenses

- [ ] Supplier invoices, creditor movements, payments, allocations, and reversals.
- [ ] Customer credit, prepaid value/litres, benefits, authorizations, payments, and invoices.
- [ ] Expenses and recurring-cost recognition/payment allocation.

## Phase 6 — Profitability, Reporting & Owner Dashboard

- [ ] Canonical profitability and operational financial position.
- [ ] Reports, PDF/XLSX exports, lineage, as-of behavior, dashboards, and Explain This Number.

## Phase 7 — Production Hardening

- [ ] Security/RLS review, performance, accessibility, weak-network/offline drafts, observability, backup/restore, incident readiness.

## Phase 8 — Pilot & Cutover

- [ ] Onboarding readiness, controlled opening positions, training, shadow operation, discrepancy classification, and pilot exit gates.
