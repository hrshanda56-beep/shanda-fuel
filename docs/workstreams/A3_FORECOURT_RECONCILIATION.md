# A3 — Forecourt and reconciliation

## Role and mission

Build the first complete operational vertical slice: business day → shift → meter boundaries/segments → payment declaration → reconciliation → approval/posting → basic daily report.

## Owned areas

Station business days, shifts, attendants, meters/installations, meter boundaries, meter segments, effective pricing seams, payment declarations, reconciliation revisions, approval integration, sale-recognition integration, and the first operational daily report flow.

## Allowed modifications

Forecourt, pricing, reconciliation, and owned workflow UI/application/domain/schema/tests; published contracts for sale/reconciliation outputs coordinated with A0/A1/A5/A7.

## Forbidden modifications

Duplicate inventory sale movements, client-authoritative litres, arbitrary status updates, silent posted edits, tax invention, cash/provider settlement implementation, or direct manipulation of another module's ledgers.

## Dependencies and inputs

A0/A1 foundation, platform contracts, exact type contracts, Wireframes, and approval/reporting seams.

## Deliverables

Named commands and state transitions, server-derived segment quantity/value, price-boundary behavior, declaration/reconciliation workflow, approval/post/lock semantics, audit trace, and basic daily report source contract.

## Required tests

Meter arithmetic, lower-reading rejection, price segmentation, shift/date semantics, forbidden transitions, reconciliation variance/classification, no-double-count sale recognition, approval-version checks, tenant isolation, and critical E2E/axe flows.

## Handoff and completion

Show one complete trace from observed meter readings to approved/postable outputs. Document inventory-sale versus financial-sale boundaries and provide test/ migration/contract handoff to A0/A4/A5/A7.

## A3 security and integration remediation

Authoritative A3 commands accept only a server-resolved A1 execution context. The path is Better Auth session → A1 actor and active membership → server-loaded station and legal entity → station-scoped A1 permission/assurance check → trusted tenant transaction. Client payloads may name a responsible attendant subject, but cannot set tenant, station, actor, membership, approval, posting, audit, or server-time fields. On-behalf-of records preserve the responsible subject while `enteredBy`, `confirmedBy`, `approvedBy`, and `postedBy` come from the trusted context.

The A3 persistence model uses composite tenant/station references for station-owned parents and children: business days, shifts, meter installations, boundaries, segments, reconciliations, and reconciliation revisions. Domain checks repeat these relationships before persistence. The lock order for commands is station business day → shift → meter installation/nozzle → boundaries/segments → reconciliation → exact revision → idempotency key; all versioned updates use an expected version and fail with conflict on a stale value. The command type owns a reviewed policy mapping for permission, station scope, assurance, attendant eligibility, and expected-version requirements; callers cannot submit a weaker permission. Business-day locking uses the dedicated `business_day.lock` permission with step-up assurance rather than the generic approval permission.

Idempotency is canonical on `(tenant_id, command_type, idempotency_key)` with a request-hash conflict check and runs inside the same transaction as authorization, business transition, audit, and outbox. Stateful workflow tables accept only their declared initial state on INSERT and enforce named transitions on UPDATE. PostgreSQL guards make sealed segments, approved/posted/locked revisions, locked business days, and active historical prices append-only while permitting only the named `APPROVED → POSTED` and `POSTED → LOCKED` provenance transitions. Direct PostgreSQL workflow jumps are rejected. Corrections use returned/draft revisions or named correction/reversal commands, and persisted lineage identifies source segments and correction/reversal revisions.

The event seam is explicit: `forecourt.meter_segment_sealed.v1` carries product/litre/meter-installation and boundary/correction lineage; `reconciliation.approved.v1` is emitted only for `APPROVED`; `reconciliation.posted.v1` is emitted only for `POSTED`; and `forecourt.business_day_locked.v1` records the lock. Events contain typed, stable snapshots, source segment/revision lineage, and payment declaration totals, not future A4 costing or A5 ledgers. Database-backed idempotency, append-only audit provenance, and outbox delivery records are tenant-isolated and transaction-bound.

## A3 implementation handoff

The isolated `agent/a3-core-forecourt` slice now contains the framework-free domain/state-machine layer, exact decimal meter/reconciliation calculations, typed event contracts, the A3 schema proposal and canonical migration `0003_a3_forecourt_reconciliation.sql`, tenant/RLS/effective-range constraints, permission-code additions, command-pipeline ports for idempotency/audit/outbox, and the representative responsive operational surface. A0 must review/integrate the canonical migration and role-permission seed additions before merge. A4 consumes `forecourt.meter_segment_sealed.v1`; A5/A7 consume reconciliation approval/posting snapshots.
