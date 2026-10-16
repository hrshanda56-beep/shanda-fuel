# Standard operating procedures

Read [release/access rules](README.md). These procedures apply only when the action is enabled for the user's authorized scope. B and C labels are compared in [verification](verification.md). They are reusable application procedures; the station must supply its custody, safety and escalation policies.

## State card

| Displayed state | Staff meaning                                                                                     | Permitted next work                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DRAFT           | Saved working evidence; server revision may be READY. Unsaved screen edits are not a saved draft. | Authorized draft capture/save, then submit after checks.                                                       |
| SUBMITTED       | Evidence sent for review; internally includes pending approval.                                   | Authorized independent review, return or approval. Ordinary editing stops.                                     |
| RETURNED        | Reviewer requires correction and has supplied a reason.                                           | Read reason, correct through supported draft commands, save and resubmit. Resubmission creates a new revision. |
| APPROVED        | Authoritative revision approved; canonical sale evidence posted.                                  | Review; use a named authorized correction path for mistakes.                                                   |
| LOCKED          | Ordinary changes blocked.                                                                         | Escalate for a supported compensating/correction procedure.                                                    |

Business-day and shift states are separate. Approval is not cash banking, provider settlement or business-day lock.

## 1. Start of business day

**Who:** authorized day opener (`business_day.open`). **Before:** real station setup, timezone and shift templates available.

1. Select station; open Daily Operations control room.
2. Check current business date and existing day. Do not duplicate an already-open day.
3. Use **Open business day** and complete its confirmation if offered.
4. Refresh and confirm OPEN and the correct date. Escalate missing setup or rejected dates.

Source command: `OpenBusinessDay`; [control room](../../src/modules/forecourt/ui/operations-control-room.tsx).

## 2. Shift opening

**Who:** `shift.start` holder. Check the planned shift, time window and actual team. Select **Start shift** on the correct shift. Verify OPEN after success. Do not start a second shift as a workaround for missing readings or a version conflict. Opening meter evidence is a separate task.

Command: `StartShift`; [lifecycle checks](../../src/modules/forecourt/commands.ts).

## 3. Pump/meter verification

**Who:** permitted boundary capture operator and supervisor. Match physical pump, nozzle, fuel and meter installation to the application. Check opening boundary and current price before use. Use My Shift **Record reading** when offered. Verify persisted result. Missing meter/price, unavailable reading, reset or replacement requires supervisor investigation; never invent a reading.

Commands: `ConfirmBoundary`, authorized exception commands; [My Shift](../../src/modules/forecourt/ui/my-shift-workspace.tsx).

## 4. Attendant assignment

**Who:** authorized supervisor/operator. Verify real roster and existing staff records. Select the attendants in the reconciliation team and save. Confirm the persisted team. This uses `SetAttendants`; it does not create membership or change nozzle responsibility. Confirm nozzle handover separately through the supported authorized workflow (`HandoverAttendant` exists at the backend). Escalate absent assignment UI.

Source: [draft workspace](../../src/modules/forecourt/ui/daily-operations-workspace.tsx), [commands](../../src/modules/forecourt/commands.ts).

## 5. Meter closing

**Who:** authorized capture and shift-close operators. Confirm nozzle, closing value, boundary time and responsible attendant. Verify opening-to-closing evidence and sealed segments before closing the shift's meters. B **Close meters** is a lifecycle action requiring evidence already complete; it does not collect missing values. Sealing and row entry are distinct operations.

**C only:** the guided **Close meters** sheet captures closing evidence, seals segments and closes meters. If interrupted, retain the same sheet/browser session and use **Retry close meters** without changing frozen inputs. Reload can restore the stored attempt where session storage works. Cross-device/tab recovery is not promised. If uncertainty remains, escalate with the shift ID and last known saved state.

Commands: `ConfirmBoundary`, `SealSegment`, `CloseMeters`; [baseline control room](../../src/modules/forecourt/ui/operations-control-room.tsx). Candidate source is pinned in [verification](verification.md).

## 6. Payment declaration

**Who:** authorized reconciliation submitter. Collect receipts/channel totals for the exact shift. Enter each real payment once using the matching method, amount and applicable reference/note. Cash, POS and EcoCash are separate. B offers payment rows; C supplies fixed Cash/EcoCash/Card rows. Save and reload to confirm allocations. Customer credit requires a real customer/account and applicable policy; selecting a payment category does not satisfy those requirements. Escalate required attribution the UI cannot capture.

Command: `SavePaymentAllocations`; [production contract](../../src/modules/forecourt/production-reconciliation.ts).

## 7. Expense recording

**Who:** authorized reconciliation operator. Check receipt/payee and station authorization. Enter category, **Description**, **Amount**, **Paid by**, and supported reference/payee details. Save; verify persisted expense and payment method. A cash expense must reflect an actual cash payment. Keep evidence using the station's approved process. This is not a general expense approval/allocation lifecycle.

Command: `SaveExpenses`; [workspace](../../src/modules/forecourt/ui/daily-operations-workspace.tsx).

## 8. Reconciliation review and submission

**Who:** submitter first, then independent authorized reviewer. Confirm team, readings, price, payments, expenses, counted cash, linked deliveries/dips and derived totals. Explain each required non-zero SALES, CASH and STOCK variance; the current stock rule requires an explanation for any non-zero variance, without assumed tolerance. Save, verify loaded totals and submit using the label for the release. Confirm SUBMITTED before handing off. The reviewer checks original evidence, submitter identity and explanations. Return incomplete evidence with a clear required reason if authorized. On C choose **Send back**, enter **Return reason**, then confirm **Send back for correction?** using **Send back**.

Commands: `SaveCashDeclaration`, `SaveVarianceExplanations`, `SubmitProductionReconciliation`, `ReturnProductionReconciliation`; [ADR-006](../decisions/ADR-006-daily-reconciliation-evidence.md).

## 9. Secure approval

**Who:** different authorized approver with `reconciliation.approve`, correct scope and strong authentication. Start only from SUBMITTED. Review all figures and exceptions; do not approve your own submission.

B offers **Approve production reconciliation** but does not supply the candidate's integrated approval identity dialog. If fresh assurance cannot be established through a supported UI, stop and escalate.

C opens **Verify identity for approval**. Better Auth uses **Current password** and **Authenticator code**; enrollment, if needed, uses **Set up authenticator** and **Confirm authenticator enrollment**. Store recovery codes privately. Clerk uses **Verify identity** / **Manage account MFA** and its strict provider challenge. Cancel or failure means no approval should be attempted. After successful verification, review **Approve these figures?**, then **Approve**. Reopen and confirm persisted APPROVED. A stale record must be refreshed and reviewed again. An uncertain response must be checked before repeating.

Command: `ApproveProductionReconciliation`; [authorization contract](../../src/modules/forecourt/application.ts). C source is listed in verification.

## 10. End-of-day reporting

**Who:** authorized supervisor and finance/owner reviewer. Use **View statement** and available Reports for the correct station/date. Compare all operated shifts, reconciliation states, cash and provider follow-up. Identify incomplete evidence explicitly. Complete eligible shifts, then **Close business day** only when prerequisites are met. **Lock business day** is a separate privileged, irreversible action; use its verification only when authorized. Retain unresolved items with an owner and follow-up time under station policy.

Commands: `CompleteShift`, `CloseBusinessDay`, `LockBusinessDay`; [control room](../../src/modules/forecourt/ui/operations-control-room.tsx), [report catalog](../../src/modules/reporting/catalog.ts).

## 11. Incorrect reading or amount

Stop the affected action. Preserve actual meter/receipt evidence. If an ordinary DRAFT/RETURNED field is editable, correct it and save, then recheck totals. A saved boundary or sealed segment is not corrected by changing a displayed reconciliation row. Escalate for the applicable named correction. For SUBMITTED, request authorized return. For APPROVED/LOCKED, use procedure 14. Do not delete, offset with fictitious payments or force a match.

## 12. Interrupted network request

Stop repeated clicks. Keep the page open and note station/date/shift, action, time and visible status. A lost response can hide a successful write. On reconnection inspect persisted state before doing anything new. Use the existing unchanged retry when offered; do not change values to evade a conflict. C meter-close recovery has the specific limits in procedure 5. Other drafts have no general offline-sync guarantee. If you cannot prove the outcome, escalate before starting another operation.

## 13. Suspected discrepancy

Recheck source readings/receipts and selected scope without modifying evidence. Record affected station, business date, shift, reconciliation ID, category, exact amount/quantity and safe error text. Notify the station's designated supervisor and finance/owner contact. Use the explanation/return workflow where authorized. Do not accuse staff, erase evidence or approve simply to clear the queue. The station supplies escalation contacts and urgency rules before launch.

## 14. Supported correction

For RETURNED, read the reason, make permitted evidence corrections, save and resubmit; prior revision history remains. For authoritative meter errors, named backend commands include `CorrectMeterSegment`, `ResetMeter` and `ReplaceMeter`, each with separate prerequisites/permissions; they are not general staff API instructions. Approved/locked evidence needs a separately reviewed named revision/compensation path. The existence of a command or UI message does not establish a complete end-user correction screen. If absent, stop and refer to the integration/support owner. Never use direct database edits, arbitrary status updates or approval bypasses.
