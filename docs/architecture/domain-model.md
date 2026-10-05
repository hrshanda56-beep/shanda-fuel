# Domain model

Reserved for the implementation domain model and aggregate-boundary notes.

The canonical product/domain meaning is in [`../PRODUCT_SPEC.md`](../PRODUCT_SPEC.md)
and [`../ARCHITECTURE.md`](../ARCHITECTURE.md). This artifact documents
implementation decisions without replacing the canonical knowledge base.

## A3 forecourt model

The A3 module keeps the physical and financial boundaries distinct:

- `StationBusinessDay` owns a station-local `BusinessDate`; multiple unfinished dates are valid.
- `Shift` owns planned/open/meter-closed/completed and explicit not-operated/exceptional exits.
- `Meter` is the device identity; `MeterInstallation` is its effective-dated relationship to one nozzle.
- `MeterBoundary` records a confirmed reading and reason. `MeterSegment` records immutable opening/closing snapshots, the responsible attendant, entered-by/on-behalf-of metadata, price snapshot, exact litres, and expected value.
- `ReconciliationRevision` is immutable per submission. Declarations classify meter-derived sales for later cash/provider/customer modules; they do not create those ledgers.

The public A3 contract publishes `forecourt.meter_segment_sealed.v1` for A4 inventory consumption and reconciliation approval/posting events for A5/A7 consumers. No A3 table is a universal financial transaction table.

## REV1 revenue model

The Revenue module owns `sale_recognition_movements`, one append-only ordinary
fuel-sale row per positive unsuperseded sealed meter segment. It consumes the
segment price snapshot, A5 approved reconciliation/segment bridge, the A4 SALE
movement, and A12 COGS lineage. `accounted_sales`, payment declarations, and
reading-level `sales_value` remain reconciliation evidence rather than revenue
authority.
