# ADR-011 — Daily operations workspace composition

## Status

Proposed for A0/integration review.

## Context

A3–A10 already provide production reconciliation commands, exact server-derived totals, cash custody, provider settlement, inventory evidence, customer-account linkage, and reporting. The existing UI exposes those capabilities through disconnected or read-heavy surfaces. A11 needs one mobile-first station-day workspace without creating a second reconciliation model or browser-owned financial calculations.

## Decision

A11 adds a tenant-aware composition read, `GET /api/forecourt/operations/daily`, for station/day/shift context, eligible attendants, active nozzles, active prices, and prior meter context. It explicitly authorizes `reconciliation.view` at the resolved station scope, then runs through the trusted A1/A3 command context and tenant transaction. Historical setup is evaluated against the persisted shift interval, not the server clock. Draft detail writes continue to use the existing named A5 production commands with optimistic versions and per-save-attempt idempotency keys; uncertain attempts are abandoned after canonical reload rather than falsely presented as resumable. The UI renders A6/A9 downstream summaries as optional status context and links to A10 reporting; it does not infer collection, banking, settlement, or customer-account linkage from approval.

No schema migration is required. The route structure is `/operations`, `/operations/daily`, and `/operations/reconciliations/[id]` with a review route. The existing station reconciliation routes remain compatible during integration.

## Consequences

- A11 can start a new draft with real station setup context rather than inventing nozzle or price identifiers in the browser.
- Server/domain code remains authoritative for all money, litres, variance, stock, and workflow state.
- A0/integration must review the new composition query, permission projections, PostgreSQL integration coverage, and fresh-server E2E before merge.
- Station master-data selection and offline synchronization remain out of scope.
