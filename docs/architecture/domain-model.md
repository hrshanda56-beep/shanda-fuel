# Domain model

Reserved for the implementation domain model and aggregate-boundary notes.

The authoritative domain meaning remains in [`../spec/MASTER_BLUEPRINT.md`](../spec/MASTER_BLUEPRINT.md). This artifact will document implementation decisions without replacing that source.

## A3 forecourt model

The A3 module keeps the physical and financial boundaries distinct:

- `StationBusinessDay` owns a station-local `BusinessDate`; multiple unfinished dates are valid.
- `Shift` owns planned/open/meter-closed/completed and explicit not-operated/exceptional exits.
- `Meter` is the device identity; `MeterInstallation` is its effective-dated relationship to one nozzle.
- `MeterBoundary` records a confirmed reading and reason. `MeterSegment` records immutable opening/closing snapshots, the responsible attendant, entered-by/on-behalf-of metadata, price snapshot, exact litres, and expected value.
- `ReconciliationRevision` is immutable per submission. Declarations classify meter-derived sales for later cash/provider/customer modules; they do not create those ledgers.

The public A3 contract publishes `forecourt.meter_segment_sealed.v1` for A4 inventory consumption and reconciliation approval/posting events for A5/A7 consumers. No A3 table is a universal financial transaction table.
