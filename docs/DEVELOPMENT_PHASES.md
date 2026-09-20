# Development phases

Phases are dependency stages, not a demand that every agent start at once. Parallel work is allowed only when the required contracts and integration base exist.

## Phase 0 — Repository and engineering foundation

A0 establishes the application/toolchain baseline, CI, test harnesses, Drizzle infrastructure, environment validation, modular directories, and shared platform primitives.

## Phase 1 — Tenancy, identity, authorization, and security

A1 establishes identity integration, memberships, roles, permissions, tenant context, RLS, runtime role separation, and tenant-isolation proof with A0 database coordination.

## Phase 2 — Core forecourt vertical slice

A3 builds business day → shift → meter boundaries/segments → payment declaration → reconciliation → approval/posting → basic daily report. It depends on Phases 0–1 contracts.

## Phase 3 — Inventory, tanks, deliveries, and costing

A4 builds physical observations, book inventory, deliveries, transfers, adjustments, perpetual WAC, and revaluation. It consumes forecourt and platform contracts.

## Phase 4 — Cash, banking, and electronic settlements

A5 builds custody, handovers, disputes, deposits, provider declarations, settlement, and bank confirmation. It consumes payment/reconciliation contracts.

## Phase 5 — Suppliers, customers, and expenses

A6 builds creditor, customer, prepaid, benefit, expense, recurring-cost, and payment workflows. It depends on the relevant inventory, cash, and approval contracts.

## Phase 6 — Profitability, reporting, and owner dashboard

A7 builds canonical calculations, operational position, reports, exports, lineage, and explanations from authoritative sources.

## Phase 7 — Production hardening

A8 coordinates cross-module E2E, security, RLS, performance, accessibility, weak-network behavior, observability, recovery, and release documentation.

## Phase 8 — Pilot and cutover

The integrated team validates onboarding readiness, controlled opening positions, role training, shadow operation, discrepancy classification, and pilot exit gates.

Dependency summary: Phase 0 enables all later work; Phase 1 is required for tenant-owned business slices; Phase 2 establishes the first complete operational flow; Phases 3–5 may overlap only after their shared contracts are stable; Phase 6 consumes authoritative outputs; Phase 7 spans the integrated system; Phase 8 follows release readiness.
