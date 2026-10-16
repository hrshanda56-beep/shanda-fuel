# Finance guide and quick reference

Applies to B with C approval UI marked below. Read [access rules](README.md).

## Quick reference

1. Select the authorized legal entity/station and reporting period.
2. Review **Daily Operations** / **View statement**, then compare meter sales with payment declarations, expenses and physical cash counts.
3. Investigate shortages and overages. Preserve actual evidence and explanations; do not overwrite amounts to make totals agree.
4. Open **Cash**, **Settlements**, **Customers**, **Suppliers** or **Reports** as permitted. Confirm evidence state and period before comparing totals.
5. Approve only a submitted reconciliation reviewed by a different authorized actor, with current strong authentication. C provides the integrated identity dialog; see [secure approval](procedures.md).
6. Separate cash received, handed over, deposited and bank-confirmed; separate electronic declarations from provider settlement. Missing evidence stays outstanding.
7. Record unresolved items with the station, date, shift, record identifier, amount/channel and responsible follow-up person. Sign out.

## Sales, cash and differences

Expected sales are derived server-side from authoritative meter evidence and price boundaries. Accounted sales come from declared payment channels. Sales variance, cash variance and stock variance are different checks. A cash-paid expense affects the cash comparison; it must not be silently treated as a reduction in fuel litres or sales.

Use the signed variance and its label, then trace the underlying evidence before describing a shortage or overage. Do not assume one sign convention across reports. Preserve the exact precision shown by the application and underlying receipt; do not round four-decimal money values into a different record.

Cash declaration is a count, not a bank deposit. At `/stations/{stationId}/cash`, review the controls actually available for collections, handovers and deposits. A real bank deposit needs its reference and custody evidence. If the required fields or authorized action are unavailable, escalate rather than calling a declaration banked. At `/stations/{stationId}/settlements`, inspect provider evidence and settlement state. A POS/EcoCash amount is not confirmed receipt merely because it appears in reconciliation. Provider integrations and automatic bank matching are not guaranteed by these guides.

## Reconciliations, reports and controls

The FINANCE template includes reconciliation view/approve/post, report view/export, cash and provider permissions, and customer statement/payment capabilities. It does not imply unrestricted station access, reconciliation return or staff administration. Actual scoped grants remain authoritative. Finance needing a return should escalate to an authorized Owner/Administrator unless an explicit return grant exists.

Open `/reports` and select an available report. Read filters, missing-information messages and source-state labels. `/customers` and customer detail support balance/activity review; use a statement action only where offered and authorized. A report, export or statement is not a ledger adjustment, receipt, tax calculation or final settlement. Do not promise a complete general ledger, FX, tax, profitability or every planned customer lifecycle action.

Approval preserves audit history and locks ordinary edits. Approved/locked mistakes require a reviewed named correction or compensating workflow; if no supported UI is available, escalate. Never repair the database directly or approve from someone else's signed-in session.
