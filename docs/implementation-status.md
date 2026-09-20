# Implementation status

Status: **A1 SECURITY REMEDIATION CANDIDATE — PR #2 OPEN, CI PASS, A0 MIGRATION INTEGRATION PENDING**

## Current integration base

`cd63d48b7a142905722d7c9ec76da053c29fbbb4` (`origin/main`, required A1 integration baseline)

A1 candidate branch: `agent/a1-platform-security` in the isolated worktree `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a1`, PR [#2](https://github.com/hrshanda56-beep/shanda-fuel/pull/2). It must enter `main` through review; `main` remains untouched. The candidate includes a migration-ready proposal that A0 must fold into the canonical migration sequence.

The current main baseline contains engineering infrastructure and no substantial Shanda Fuel business logic. The A1 remediation adds the trusted tenant-authority path, server-side Better Auth actor resolution, fail-closed strong-auth and origin validation, explicit security-event scope, and PostgreSQL negative tests. Static, unit, build, and expanded PostgreSQL validation pass in CI. Canonical migration integration and review remain pending.

## Phase 0 — Repository & Engineering Foundation

- [x] A0 establishes the technical baseline and pinned compatible toolchain.
- [x] Shared lint, format, typecheck, unit, integration, E2E, accessibility, and CI gates exist.
- [x] Drizzle/PostgreSQL development and migration workflow is established.
- [x] Environment validation and secret-safe configuration exist.
- [x] Modular monolith boundaries are implemented.

Remediation validation: the namespace migration was applied successfully to PostgreSQL 16 in a dedicated ephemeral test database; `pnpm test:integration` executed 2 real PostgreSQL assertions against it. Unit discovery is separate and does not include integration tests.

## Phase 1 — Tenancy, Identity, Authorization & Security

- [ ] Authentication integration (A1 candidate adds the server-only Better Auth boundary; canonical auth schema integration remains pending review).
- [ ] Tenant, legal entity, station, membership, role, permission, and scope foundation (A1 candidate supplied the application contracts and migration-ready schema proposal).
- [ ] Tenant context, RLS, runtime role separation, audit/security foundation (A1 candidate supplied the fail-closed RLS and role-separation proposal).
- [ ] Automated tenant-isolation tests (A1 candidate adds real PostgreSQL CRUD, missing-context, composite-FK, and non-bypass runtime-role coverage; CI passes, phase remains pending canonical integration).

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
