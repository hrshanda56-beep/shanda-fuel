# Implementation status

Status: **PRE-A0 REPOSITORY PREPARATION**

## Current integration base

`Not yet established.`

This baseline contains specifications and coordination documentation only. No substantial Shanda Fuel application or business logic has been started.

## Phase 0 — Repository & Engineering Foundation

- [ ] A0 establishes the technical baseline and pinned compatible toolchain.
- [ ] Shared lint, format, typecheck, unit, integration, E2E, accessibility, and CI gates exist.
- [ ] Drizzle/PostgreSQL development and migration workflow is established.
- [ ] Environment validation and secret-safe configuration exist.
- [ ] Modular monolith boundaries are implemented.

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
