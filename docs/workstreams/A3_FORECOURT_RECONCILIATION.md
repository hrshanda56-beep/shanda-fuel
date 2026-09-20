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

## A3 implementation handoff

The isolated `agent/a3-core-forecourt` slice now contains the framework-free domain/state-machine layer, exact decimal meter/reconciliation calculations, typed event contracts, the A3 schema proposal and canonical migration `0003_careful_lord_hawal.sql`, tenant/RLS/effective-range constraints, permission-code additions, command-pipeline ports for idempotency/audit/outbox, and the representative responsive operational surface. A0 must review/integrate the canonical migration and role-permission seed additions before merge. A4 consumes `forecourt.meter_segment_sealed.v1`; A5/A7 consume reconciliation approval/posting snapshots.
