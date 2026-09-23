# ADR-006 — Shift-scoped daily reconciliation evidence

## Status

Proposed for A0 migration integration and A3/A4/A5 review.

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

## Integration notes

- A0 must sequence the migration after the existing A3 forecourt migration and
  reconcile the tank foreign key with the inventory/tank schema when A4 lands.
- Existing day-aggregate reconciliation rows need a controlled backfill or an
  explicitly documented historical exception before `shift_id` becomes NOT NULL.
- No Zimbabwe tax treatment, supplier settlement, customer credit ledger, cash
  custody lifecycle, calibration, or bank/provider settlement is introduced by
  this slice.
