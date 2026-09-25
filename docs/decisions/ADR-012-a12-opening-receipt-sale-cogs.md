# ADR-012 — A12.3 opening, receipt, and segment-sale costing

## Status

Proposed for A0/integration review.

## Context

A12.2 established append-only cost events, immutable sale attribution, and
deterministic WAC replay, but the application runtime could not persist the
projection state. Direct table writes would weaken the intended privilege
boundary. A12.3 also needs to make approved A5 sales financially usable without
inventing delivery allocation policy or silently revaluing historical sales.

## Decision

Migration `0012_a12_cost_projection_writer` adds one `SECURITY DEFINER`
projection writer owned by `migration_owner`. It checks the current tenant,
optional station context, and active membership, accepts the complete existing
projection row, and performs one insert-or-update with a database-controlled
`updated_at`. `app_runtime` receives only function execution; it receives no
direct projection table write privileges and the table remains `FORCE ROW LEVEL
SECURITY`.

Opening and receipt valuation commands append `OPENING_COST` and `RECEIPT_COST`
events, replay the authoritative A4 movement/cost chronology, and persist the
projection through that function. Delivery header cost fields remain delivery-
level evidence only for A12.3. Allocation of those delivery-level costs remains
`REQUIRES_CLIENT_DECISION`; A12.3 receipt valuation therefore requires an
explicitly supplied authoritative amount and currency for the exact delivery
allocation. No total delivery cost is split across tanks automatically.

Approved A5 production reconciliation posts each canonical meter-segment sale,
its one negative `SALE_COGS` event, one immutable `PRE_SALE_WAC` attribution,
and the stream projection in the same transaction. Unvalued or insufficient
stock blocks approval. Mixed currencies and receipt/opening costs arriving after
historical sales are rejected; historical late-cost revaluation remains A12.4.

## Consequences

- Projection state is writable atomically without granting `app_runtime` direct
  table mutation authority.
- Retries are safe through existing command idempotency plus source uniqueness
  and attribution uniqueness.
- A12.4 remains responsible for historical COGS/inventory revaluation.
- A10 reporting is unchanged; it may consume the new authoritative costing
  records in a later reporting slice.
