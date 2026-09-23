# A4 — Inventory and deliveries

## Role and mission

Implement physical tank observations and canonical book inventory, delivery workflows, transfers, adjustments, and perpetual weighted-average costing.

## Owned areas

Inventory pools, tanks, calibration, dips, inventory movements, delivery arrival/verification/offload/partial receipt/confirmation/posting, allocations, transfers, approved adjustments, WAC, late-cost revaluation, and related evidence.

## Allowed modifications

Inventory, tanks, deliveries, purchasing receipt seams, costing calculations, owned schemas/tests/UI, and published inventory contracts.

## Forbidden modifications

Letting dips silently alter book stock, using supplier invoice quantity as physical receipt authority, negative stock as normal behavior, rewriting historical sales/receipts for late costs, or direct mutation of creditor/cash ledgers.

## Dependencies and inputs

A0/A1 foundation, A3 meter-sale movement contract, purchasing/creditor contract, exact arithmetic, document, approval, and audit contracts.

## Deliverables

Atomic receipt movement/projection behavior, partial/interrupted delivery workflow, tank quarantine/exception seam, transfers, adjustments, WAC, and explicit revaluation splitting remaining inventory from consumed cost.

## Required tests

Delivery variance, accepted allocation quantity, partial receipt, WAC chronology, revaluation split, dip-versus-book separation, stock conservation, idempotent posting, RLS/isolation, and critical E2E flows.

## Handoff and completion

Document inventory movement authority, cost assumptions, projection rebuild behavior, and contracts consumed by suppliers/reporting. Update status with test evidence.

## A4 integration contract

The canonical A4 persistence is in `src/platform/db/schema/a4.ts` and migration `0004_a4_inventory.sql`. Tanks, dips, deliveries, delivery allocations, and inventory movements are tenant/station scoped with composite product relationships; the movement ledger is append-only and stock is derived from signed exact-decimal movements. Tank calibration points are stored as observations only: conversion/interpolation rules remain pending confirmation of the actual station calibration charts, while direct litre dips are supported.

The production server path is authenticated authority → station-scoped inventory command → `withTenantTransaction` → PostgreSQL. `POST /api/inventory/commands` supports tank lifecycle, dips, delivery creation/confirmation, opening balances, and controlled adjustments. `GET /api/inventory/stock` exposes persisted expected/physical/variance projections for later consumers. Delivery confirmation atomically posts one `DELIVERY` movement per allocation. The implemented A5 reconciliation adapter uses `postInventoryMovementInTransaction` to post one idempotent `SALE` movement per approved meter reading; reconciliation references these A4 entities rather than defining duplicate tanks, dips, deliveries, or inventory ledgers.
