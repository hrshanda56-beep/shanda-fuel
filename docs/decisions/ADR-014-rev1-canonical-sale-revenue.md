# ADR-014 — REV1 canonical ordinary fuel-sale revenue

- Status: Accepted for REV1 implementation wave 1
- Decision owners: REV1 revenue workstream, with A3/A4/A5/A12 review
- Scope: ordinary fuel sales represented by sealed A3 meter segments

## Decision

`app.sale_recognition_movements` is the authoritative sale-revenue ledger for
ordinary fuel in REV1. It is an append-only, tenant-scoped financial movement
table owned by the dedicated revenue module. A10 must consume this authority
for future profitability reporting; it must not infer revenue from payments,
declarations, or a reading aggregate.

One positive revenue movement is posted for each positive, unsuperseded, sealed
A3 meter segment when the approved A5 production reconciliation posts. The
posting is in the same database transaction as the canonical A4 `SALE` and the
A12 `SALE_COGS` movement/attribution. The transaction order is A4 quantity,
A12 cost, then revenue; any failure rolls back all three authorities.

## Locked accounting contract

| Field | Contract |
| --- | --- |
| Source identity | `source_type = METER_SEGMENT_SALE`, `source_id = meter_segment_id`; unique per tenant, source, and classification |
| Economic amount | `recognized_revenue_amount = round(segment.litres * segment.unit_price, 4)` using exact decimal half-up money policy |
| Reconciliation amount | For `ORDINARY_FUEL_SALE`, `reconciliation_value` equals the recognized amount; it is the segment-level value, not A5 `accounted_sales` |
| Sign | Positive revenue amount; litres positive |
| Currency | USD, matching the current authoritative fuel-sale model |
| Economic effective time | A3 `meter_segments.segment_end_at` |
| Business date | A3 station business day attached to the segment |
| Dimensions | Tenant, legal entity, station, product, tank from A4 SALE, nozzle, shift, segment, A5 reading/reconciliation/revision |
| Posting provenance | Actor membership, request ID, posting time, immutable replay fingerprint |
| Idempotency | Natural source uniqueness plus exact payload verification on replay; a conflicting payload fails |
| Immutability | No update/delete; future corrections, reversals, refunds, discounts, tax, non-fuel, internal, benefit, and FX classifications require separately approved named contracts |

The database trigger verifies the segment is sealed and not superseded, the
amount and dimensions match A3, the A5 bridge exists for the revision being
approved, and the linked A4 movement is the canonical negative-litre SALE for
the same segment and time. It also requires the matching A12 `SALE_COGS`
attribution. The trigger permits the `SUBMITTED`/`PENDING_APPROVAL` state only
for this in-flight approval transaction; the transaction commits only after the
reconciliation and revision become `APPROVED`.

## Reconciliation tie-out

For an approved revision, the authoritative ordinary fuel total is the sum of
its revenue rows, and must equal the sum of `round(segment.litres *
segment.unit_price, 4)` over its approved A5-to-A3 bridge. This is a deterministic
segment tie-out, not a payment tie-out. `accounted_sales` remains compared to
A5's finalized expected/control amount for the reconciliation variance; it is
not required to equal the revenue total. A5 reading `sales_value` agrees with
the segment total only where its single reading price basis covers the same
price interval. If a reading spans a price change, the segment sum is
authoritative and the reading aggregate is evidence of the older A5 calculation.

## Meaning of existing A5 amounts

`reconciliation_revisions.accounted_sales` remains the finalized declaration
and payment-evidence total. It is a control/variance amount and is not revenue.
`reconciliation_meter_readings.sales_value` remains the A5 reading-level
expected retail value. It is useful as an operational aggregate, but it is not
the posted revenue authority once a reading spans price-change segments.

Differences between these values are retained as reconciliation evidence. They
must not change canonical revenue. Payment method, customer credit, prepaid,
cash custody, provider settlement, discounts, tax, and rounding policy outside
the segment price derivation do not create or alter a REV1 ordinary sale row.

## Corrections and migration boundary

Wave 1 does not introduce historical revenue backfill, corrections, reversals,
refunds, restatements, tax, or non-fuel classifications. A superseded segment
cannot receive a new ordinary row. A future correction workflow must append a
named compensating or reversal movement and preserve the original row.

No A5 capture or payment-posting semantics change. The smallest production
change is the post-approval revenue insert in the existing A5 production
approval transaction; A10 and A12 remain unchanged in this wave.
