# TEI Oils audit-fix decisions

Date: 2026-10-28

## Implemented decisions

- A reconciliation is unique per tenant, station, and shift. Starting one twice is a typed `409`-style `RECONCILIATION_ALREADY_EXISTS` response carrying the existing reconciliation ID; the daily workspace opens that record.
- Delivery creation owns its optional before/after dips. The dips are inserted in the same inventory transaction as the draft delivery, so a failed command persists neither. Existing dip and delivery permission checks remain server-side, and step-up is requested before the transaction starts.
- A recorded tank dip is append-only except for one audited void action. Voiding requires a reason, preserves the original measurement, is refused after delivery or reconciliation linkage, and excludes the dip from operational calculations.
- Submission and approval both recompute sales, cash, and stock variance. Explanations are category-specific; red stock variance additionally requires an `APPROVER_NOTE`. Approval compares the current metrics with a stable submission snapshot and blocks changed data until correction and resubmission.
- Return-for-correction requires at least five non-whitespace characters and remains available to an authorised reviewer.

## Scope and environment

- No production database, deployment, migration run, secret, push, merge, or pull request was used.
- The branch is `fix/audit-2026-10` in the isolated worktree used for this task.
- The repository has an existing UI-lock manifest. The changed locked screens were intentionally re-recorded after the audit fixes.

## Deferred audit scope

The pasted audit also requests a broad metrics consolidation (C0–C8), notification delivery, expanded cash custody and settlement state machines, purchasing/supplier-credit completion, complete role/export/mobile/offline matrices, and additional delivery controls. Those areas require separate domain decisions and/or broader integration fixtures and are not silently represented as complete by this change.
