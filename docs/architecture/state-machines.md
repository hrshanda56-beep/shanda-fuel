# State machines

Reserved for named command/state transition tables and implementation notes.

State transitions must preserve the approval, posting, locking, reversal, expiry, and supersession semantics defined in [`../spec/MASTER_BLUEPRINT.md`](../spec/MASTER_BLUEPRINT.md).

## A3 command vocabulary

Implemented framework-free transitions are named commands, not arbitrary status updates:

| Aggregate | Commands and states |
| --- | --- |
| Business day | `OpenBusinessDay`: `NOT_STARTED → OPEN`; `MarkOperationsComplete`: `OPEN → OPERATIONS_COMPLETE`; `FinalizeOperations`: `OPERATIONS_COMPLETE → CLOSED`; `ExceptionalCloseBusinessDay` requires a reason; `LockBusinessDay`: `CLOSED → LOCKED`. |
| Shift | `StartShift`: `PLANNED → OPEN`; `CloseMeters`: `OPEN → METER_CLOSED`; `CompleteShift`: `METER_CLOSED → COMPLETED`; `MarkNotOperated` and `ExceptionalClose` require reasons. |
| Meter | `ConfirmBoundary`, `SealSegment`, `HandoverNozzle`, `ReplaceMeter`; lower readings require a reset/replacement/correction reason and explicit controlled quantity. |
| Price | `RequestPriceChange`, `ApprovePriceChange`, `ActivatePriceChange`; activation derives persisted boundary state and server time inside the transaction and is blocked until every affected nozzle boundary is sealed. |
| Reconciliation | `CalculateReconciliation`: `READY`; `SubmitReconciliation`: `SUBMITTED`; `CreateApprovalRequest`: `PENDING_APPROVAL`; `Return`/`Reject`/`Approve`/`Post`/`Lock` follow the canonical revision flow. |

The persistence adapter must lock the aggregate and check its optimistic version inside the tenant transaction before invoking these functions.

## Authorization and concurrency contract

The persistence adapter derives actor, membership, tenant, legal entity, station, assurance, and timestamps from A1. Every command binds an explicit existing permission code and station scope. The adapter uses the deterministic lock order documented in the A3 workstream and checks `expectedVersion` before the state transition. Approval and posting target an exact immutable reconciliation revision; a returned revision creates the correction path rather than rewriting approved history.
