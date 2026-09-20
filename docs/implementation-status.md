# Implementation status

Status: **A0 REMEDIATION IMPLEMENTED — PR #1 OPEN FOR RE-REVIEW**

## Current integration base

`12a2fe42d1909a0e1b92ba66ec47d72afa7bab25` (official PRE-A0 baseline)

A0 candidate branch: `agent/a0-integration-foundation` in the isolated managed worktree `a0-integration-foundation`. It must enter `main` through review; `main` remains untouched.

The A0 baseline contains engineering infrastructure and no substantial Shanda Fuel business logic. PostgreSQL integration now fails closed when unconfigured and passes against a dedicated migrated test database.

## A2 — UI foundation

Workstream branch: `agent/a2-ui-foundation` in `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a2`, based on required integration baseline `cd63d48b7a142905722d7c9ec76da053c29fbbb4`.

- [x] Semantic light/dark/system tokens, typography, spacing, focus, reduced-motion, and tabular-number conventions.
- [x] Responsive AppShell with context surface, breadcrumbs, desktop sidebar, and Home / Tasks / Work / More mobile navigation seam.
- [x] Permission-projection navigation filter that does not authorize commands in the browser.
- [x] Reusable controls, forms, numeric/date presentation formatters, status badges, responsive table/card patterns, evidence, risk-confirmation, and truthful loading/empty/error/conflict/offline/permission/not-found states.
- [x] Synthetic representative dashboard/form/state surfaces with unit, Playwright, and axe coverage.

A2 remains presentation-only. A1 supplies live actor/permission contracts; A0/integration owns shared tooling and platform wiring. No database, persistence, financial calculation, business command, authentication, or RLS work is included here.

Remediation for PR #3: mobile operating context now includes an accessible optional shift slot; dialog/bottom-sheet primitives manage focus, Escape, inert background, and restoration; mobile navigation uses valid list semantics; required controls use native/ARIA required state; and AppShell consumes typed `NavigationProjection` keys rather than raw permission identifiers.

## Phase 0 — Repository & Engineering Foundation

- [x] A0 establishes the technical baseline and pinned compatible toolchain.
- [x] Shared lint, format, typecheck, unit, integration, E2E, accessibility, and CI gates exist.
- [x] Drizzle/PostgreSQL development and migration workflow is established.
- [x] Environment validation and secret-safe configuration exist.
- [x] Modular monolith boundaries are implemented.

Remediation validation: the namespace migration was applied successfully to PostgreSQL 16 in a dedicated ephemeral test database; `pnpm test:integration` executed 2 real PostgreSQL assertions against it. Unit discovery is separate and does not include integration tests.

## Phase 1 — Tenancy, Identity, Authorization & Security

- [ ] Authentication integration.
- [ ] Tenant, legal entity, station, membership, role, permission, and scope foundation.
- [ ] Tenant context, RLS, runtime role separation, audit/security foundation.
- [ ] Automated tenant-isolation tests.

## Phase 2 — Core Forecourt Vertical Slice

- [ ] Business day and shift workflow.
- [ ] Meter installation, boundaries, segments, and server-derived sales.
- [ ] Payment declaration, reconciliation, approval/posting, and locking.
- [ ] Basic daily report and audit trace.

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
