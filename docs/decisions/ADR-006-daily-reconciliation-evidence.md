# ADR-006 — Shift-scoped daily reconciliation evidence

## Status

Implemented by canonical migration `0005_daily_reconciliation.sql` and the
production reconciliation adapters. The remaining work is regression coverage
and future business-policy decisions, not a second persistence model.

## Decision

The client-visible daily workflow is shift-scoped. A reconciliation carries the
station business day and one shift reference; the existing day aggregate rows
remain readable during cutover but new records must use a shift reference.

Sealed meter segments remain the only authoritative source for litres and sales.
Payment declarations remain the canonical immutable JSONB snapshot selected by
ADR-005, extended at the command boundary with the eight approved payment
methods and optional reference/note fields. Supervisor-entered expenses,
delivery references, tank dips, cash counts, and assigned attendants are
normalized child evidence records so they can be validated and audited without
creating a second sales or inventory ledger.

Draft evidence is editable only through named commands. Submission snapshots
all derived totals and locks ordinary editing. Return requires a reason and a
new correction revision; approval is performed by a different authorized actor
and prevents destructive edits.

## Production state mapping

The production revision and public/header records intentionally expose related
but different levels of the workflow; this is one state machine with a
documented projection, not two competing workflows:

| Production revision | Public/header representation | Meaning |
| --- | --- | --- |
| `READY` | `DRAFT` | The current revision exists and its evidence remains editable through named commands. |
| `SUBMITTED` → `PENDING_APPROVAL` | `SUBMITTED` | Submission validates server-derived totals and moves the revision through the approval-request transition. The header remains `SUBMITTED` while management review is pending, so the public API does not expose an extra transient state. |
| `RETURNED` | `RETURNED` | Management returned the current revision with a required reason; the header stores that reason and the evidence becomes editable again. |
| `APPROVED` | `APPROVED` | Management approved the authoritative revision. The header and revision are locked against ordinary edits. |

When a returned reconciliation is resubmitted, the server creates revision
`n + 1` from the current server-derived evidence, then transitions that new
revision through `SUBMITTED` and `PENDING_APPROVAL`. The prior revision remains
`RETURNED` and immutable. Approval makes only the new revision authoritative;
inventory `SALE` effects are posted from that approved revision's readings and
are idempotent by their reconciliation-reading source identity.

## Stock variance policy

The A5 read model derives stock variance as:

`physical stock - (book inventory - current reconciliation sales)`

Any non-zero derived stock variance currently requires a `STOCK` explanation
before submission or approval. A4 stores acceptable-variance configuration,
but A5 does not yet apply configurable thresholds to this workflow. Selecting
and documenting that future tolerance policy remains a business decision; the
current stricter zero-variance explanation rule is deterministic and safe.

## Integration notes

- `0005_daily_reconciliation.sql` is sequenced after the existing A3 forecourt
  migration and A4's canonical `0004_a4_inventory.sql`; reconciliation delivery
  and dip references point to A4 entities and approval posts A4 inventory
  movements.
- Existing day-aggregate reconciliation rows need a controlled backfill or an
  explicitly documented historical exception before `shift_id` becomes NOT NULL.
- No Zimbabwe tax treatment, supplier settlement, customer credit ledger, cash
  custody lifecycle, calibration, or bank/provider settlement is introduced by
  this slice.
