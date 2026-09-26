# Canonical sale revenue architecture

REV1 establishes `app.sale_recognition_movements` as the financial authority
for ordinary fuel-sale revenue. The dedicated `src/modules/revenue/` module
derives one amount per positive A3 sealed meter segment. The row is inserted
inside the A5 approval transaction while the reconciliation is still
`SUBMITTED`/`PENDING_APPROVAL`; the transaction commits only after revenue, A4,
A12, and the approval state all succeed.

The lineage is:

```text
A3 sealed meter segment
  -> A5 reconciliation reading/segment bridge and revision being approved
  -> A4 negative SALE movement
  -> A12 negative SALE_COGS event and attribution
  -> REV1 positive sale_recognition_movement
```

The segment is the calculation boundary. Revenue is exact decimal
`round(litres * segment.unit_price, 4)`. A5 `accounted_sales` and
`reconciliation_meter_readings.sales_value` remain evidence/control values and
are never fallbacks for revenue. A10 is a read-only consumer and is not changed
by this wave.

The revenue row is append-only, has forced tenant/station RLS, database-enforced
source uniqueness, and a database lineage trigger. The trigger rejects
unsealed or superseded segments, price/quantity/time/dimension mismatches,
invalid revisions, missing A5 bridge lineage, and non-canonical A4 SALE
references. Only the in-flight approval states are permitted before commit.

Corrections, reversals, refunds, discounts, tax, non-fuel, internal, benefit,
and foreign-currency revenue are intentionally not represented in REV1 wave 1.
They require named contracts before historical financial reporting can include
them.
