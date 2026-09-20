# Implementation status

Status: **A1 CANONICAL MIGRATION / DB-ROLE REMEDIATION — PR #2 OPEN, CI PENDING**

## Current integration base

`cd63d48b7a142905722d7c9ec76da053c29fbbb4` (`origin/main`, required A1 integration baseline)

A1 candidate branch: `agent/a1-platform-security` in the isolated worktree `/Users/wolftech/1TheStudio/1The Studio/shanda-fuel-a1`, PR [#2](https://github.com/hrshanda56-beep/shanda-fuel/pull/2). It must enter `main` through review; `main` remains untouched. The candidate includes a migration-ready proposal that A0 must fold into the canonical migration sequence.

The current main baseline contains engineering infrastructure and no substantial Shanda Fuel business logic. The A1 remediation adds the trusted tenant-authority path, server-side Better Auth actor resolution, fail-closed strong-auth and origin validation, tenant-scoped append-only security events, canonical migrations `0001`/`0002`, executable role bootstrap, and real PostgreSQL negative tests. A0's approved dependency compatibility decision is applied with Better Auth 1.7.5, Drizzle ORM ^0.45.2, and Drizzle Kit ^0.31.7. Local static/unit/schema gates pass; fresh PostgreSQL migration and role validation are pending CI for this revision.

## Phase 0 — Repository & Engineering Foundation

- [x] A0 establishes the technical baseline and pinned compatible toolchain.
- [x] Shared lint, format, typecheck, unit, integration, E2E, accessibility, and CI gates exist.
- [x] Drizzle/PostgreSQL development and migration workflow is established.
- [x] Environment validation and secret-safe configuration exist.
- [x] Modular monolith boundaries are implemented.

Remediation validation: the namespace migration was applied successfully to PostgreSQL 16 in a dedicated ephemeral test database; `pnpm test:integration` executed 2 real PostgreSQL assertions against it. Unit discovery is separate and does not include integration tests.

## Phase 1 — Tenancy, Identity, Authorization & Security

- [ ] Authentication integration (canonical Better Auth schema and adapter smoke path are supplied; CI verification remains pending).
- [ ] Tenant, legal entity, station, membership, role, permission, and scope foundation (canonical `0002` migration supplied; CI verification remains pending).
- [ ] Tenant context, RLS, runtime role separation, audit/security foundation (canonical RLS/grants and bootstrap supplied; CI verification remains pending).
- [ ] Automated tenant-isolation tests (real PostgreSQL CRUD, missing-context, composite-FK, role ownership, and privilege-negative coverage supplied; CI verification remains pending).

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
