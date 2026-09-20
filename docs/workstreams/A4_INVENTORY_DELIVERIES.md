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
