# ADR-013: A12.4 Late-Cost Historical Revaluation

- Status: Accepted for A12.4 and A12.5 v1 closure
- Date: 2026-09-26
- Decision owners: A12 costing workstream

## Context

A12.3 deliberately rejects a newly arriving opening or receipt cost when its
economic effective time is before an already-posted canonical sale. The normal
invariant remains unchanged: a confirmed positive A4 movement without its
authoritative cost leaves the stream `UNVALUED`, and A5 cannot approve a new
canonical sale from that stream.

The A12.4 case is different in chronology. An authoritative A4 opening or
receipt movement is recognized after a canonical sale has already been posted,
while the movement's economic `effective_at` predates that sale. A12.4 must
record the missing historical cost and restate the consumed share without
rewriting A4 quantity movements or the original sale evidence.

## Decision

### V1 posting scope

Whole-history revaluation is the only supported v1 posting semantics. A late
authoritative opening or receipt cost revalues the complete causally affected
historical stream from its effective chronology through the current projection.
It emits append-only `COGS_REVALUATION` deltas for every affected canonical
sale and allocates the remainder to ending inventory. Original A4 movements,
original `SALE_COGS` events, and original sale attributions remain immutable.

Bounded restatement is intentionally deferred from v1. The nullable
`restatementFromAt` and `restatementThroughAt` envelope fields are reserved
metadata retained for migration compatibility only; they do not define v1
replay, allocation, projection, or posting semantics. Non-null values remain
rejected at the public request boundary and must not be silently ignored.

Reporting period filtering and future `as_of` reporting are separate concerns.
They must use report period/effective criteria and posted-time cutoffs in the
reporting layer, and must not reuse these reserved revaluation fields.

### Ordinary historical cost plus append-only COGS deltas

A successful late-cost posting records the ordinary canonical historical cost
event using the existing A12.3 source identity:

- `OPENING_COST` for an opening balance;
- `RECEIPT_COST` for the exact delivery allocation;
- `effective_at` equal to the authoritative A4 movement's `effective_at`;
- the explicit amount and currency supplied by the authoritative cost command.

The original `SALE_COGS` events and `inventory_sale_cost_attributions` remain
immutable. A12.4 appends one signed `COGS_REVALUATION` event for each affected
historical canonical sale. The restated COGS for a sale is:

```text
original SALE_COGS amount + all linked COGS_REVALUATION deltas
```

The original attribution is not replaced or amended. Revaluation lines retain
the original attribution evidence and the recomputed values needed to prove
the delta and its deterministic replay.

Each generated COGS delta uses the canonical source identity
`INVENTORY_COST_REVALUATION_LINE` plus the revaluation-line ID. Its effective
time is the affected historical sale's effective time. This identity is
distinct from the meter-segment identity so multiple revaluations can affect
the same sale without violating cost-event uniqueness.

This flow does not create an `INVENTORY_REVALUATION` event. The ordinary
historical opening or receipt cost already increases inventory value; the
COGS deltas redistribute the consumed share to historical sales and the
remaining share stays in ending inventory.

### Conservation

For sequential revaluations, the immutable original COGS is never replaced:

```text
current restated COGS = original COGS + all prior COGS_REVALUATION deltas
new incremental delta = newly recomputed COGS - current restated COGS
```

After canonical quantization, every successful calculation must satisfy:

```text
late cost amount
  = sum(COGS revaluation deltas)
  + increase in ending inventory value
```

The domain calculation reports the two sides and a zero residual. A
calculation that does not conserve the amount is rejected before posting.

### Economic time and posting time

Historical economic time is retained on the ordinary cost event and affected
sale evidence. The revaluation envelope separately records request, approval,
and posting provenance and timestamps. Posting time must never replace the
historical effective time used for replay.

### Deterministic replay

Replay is ordered by effective time, then by the canonical movement/event
ordering already established by A12. A positive movement is recognized before
its matching ordinary cost event. Canonical sales are processed in effective
time and stable-ID order. The calculation simulates the original chronology
and the chronology with the late movement/cost inserted, identifies sales
after the inserted cost event, and emits stable quantized WAC, COGS, delta, and
fingerprint values.

### Atomicity and idempotency

The revaluation envelope is the workflow, audit, and idempotency boundary.
Source identity, amount, currency, chronology, and replay fingerprint must
match on a retry. Conflicting retries are not equivalent operations. Posting
must later insert the ordinary cost event, linked COGS delta events, and
revaluation lines in one transaction; any failure rolls back the complete
posting.

Lines may be inserted only while the envelope is `APPROVED`. The envelope is
transitioned to `POSTED` last, after ordinary cost, delta events, lines, and
projection persistence succeed. Once posted, no additional lines or metadata
changes are permitted.

Original A4 movements, original `SALE_COGS` events, and original sale
attributions are never rewritten.
