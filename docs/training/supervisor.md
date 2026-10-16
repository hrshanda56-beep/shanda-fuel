# Supervisor guide

Applies to B unless marked C. Read [access rules](README.md) and use the [SOPs](procedures.md).

## One-page Supervisor quick start

1. Sign in, complete prompted MFA, select your assigned station, and check business date and shift.
2. Open **Daily Operations**. If the day is not open, use **Open business day** only for the correct date and authorized station.
3. Check the planned shift and use **Start shift** when enabled. Missing templates, pumps, prices or attendants require onboarding support.
4. Verify attendants against the actual shift team. Reconciliation team selection records evidence; it is not account creation or proof of nozzle assignment.
5. Check nozzle labels, fuel, meter installation and opening readings. Attendants can use **My Shift** for permitted boundary capture.
6. At handover, verify closing readings and payment evidence. On B, **Close meters** requires meter evidence already complete. **C only:** use its guided closing sheet and recovery controls.
7. Enter payments, expenses and counted cash; explain sales, cash and stock differences. B: **Save persisted draft**, then **Submit for management review**. C: **Save now**, then **Submit for review**, check **Submit for review?**, and confirm **Submit**.
8. Reload to verify saved/submitted state. Hand off to a different authorized approver. Complete shift/day only when the application permits the transition. Sign out.

Do not assume the `SUPERVISOR` template includes reconciliation approval. It includes submission. An accountable reviewer needs the separately authorized approval permission and scope.

## Working through the day

Use the control room to inspect shifts, **Needs attention**, day state and reconciliation links. Do not open a replacement day or shift to escape an error. Where a start/close action is disabled, read its reason and resolve the prerequisite.

In the Daily Operations workspace verify attendants, meter rows and active selling price. Reconciliation reading rows must agree with authoritative sealed meter segments; typing a row is not a replacement for boundary capture and sealing. Preserve every displayed decimal digit from source evidence.

B offers payment rows with **Amount** and optional **Reference**. Available method codes are Cash, POS, EcoCash, bank transfer, customer credit, prepaid, staff/management fuel and other approved payments. A method selection alone does not authorize credit or fuel benefits. Customer identity and applicable reference/authorization policy still apply; escalate when the UI cannot capture the required evidence.

C presents fixed **Cash**, **EcoCash** and **Card (POS)** rows. Enter real channel totals once, with other channels separately. Do not count a provider receipt again as cash. B uses **Counted cash**; C uses **Cash counted**. Enter the physical count, not the amount needed to remove the variance.

Expenses need **Description**, **Amount**, category and **Paid by**. Retain receipt, payee and reference through the supported evidence process. These entries are reconciliation evidence, not a full expense approval or supplier accounting workflow.

Draft saves can contain several server commands. Stay on the page until completed; partial failure is not proof of zero writes. Review the reloaded record before submitting. Submitted evidence is no longer ordinarily editable. For **RETURNED**, read the reason, correct supported draft fields, save and resubmit. [Troubleshooting](troubleshooting.md) covers conflicts and interrupted requests.

## Exceptions and close-out

A lower meter reading, unavailable meter, wrong price, unknown attendant or mismatch needs a reason and an authorized exception/correction workflow. Never enter an artificial higher reading or balance payments to conceal a difference. The server enforces eligibility and prerequisites; the presence of a button does not override them.

**Complete shift**, **Close business day** and **Lock business day** are distinct actions from reconciliation approval. Use them only in the permitted order and scope. Lock is irreversible through ordinary editing and requires privileged verification. Escalate any unavailable secure verification path.
