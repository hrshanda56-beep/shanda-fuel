# State machines

Reserved for named command/state transition tables and implementation notes.

State transitions must preserve the approval, posting, locking, reversal, expiry, and supersession semantics defined in [`../spec/MASTER_BLUEPRINT.md`](../spec/MASTER_BLUEPRINT.md).

## A3 command vocabulary

Implemented framework-free transitions are named commands, not arbitrary status updates:

| Aggregate | Commands and states |
| --- | --- |
| Business day | `OpenBusinessDay`: `NOT_STARTED → OPEN`; `MarkOperationsComplete`: `OPEN → OPERATIONS_COMPLETE`; `FinalizeOperations`: `OPERATIONS_COMPLETE → CLOSED`; `ExceptionalCloseBusinessDay` requires a reason. |
| Shift | `StartShift`: `PLANNED → OPEN`; `CloseMeters`: `OPEN → METER_CLOSED`; `CompleteShift`: `METER_CLOSED → COMPLETED`; `MarkNotOperated` and `ExceptionalClose` require reasons. |
| Meter | `ConfirmBoundary`, `SealSegment`, `HandoverNozzle`, `ReplaceMeter`; lower readings require a reset/replacement/correction reason and explicit controlled quantity. |
| Price | `RequestPriceChange`, `ApprovePriceChange`, `ActivatePriceChange`; activation is blocked until affected nozzle boundaries are sealed. |
| Reconciliation | `CalculateReconciliation`: `READY`; `SubmitReconciliation`: `SUBMITTED`; `CreateApprovalRequest`: `PENDING_APPROVAL`; `Return`/`Reject`/`Approve`/`Post`/`Lock` follow the canonical revision flow. |

The persistence adapter must lock the aggregate and check its optimistic version inside the tenant transaction before invoking these functions.
