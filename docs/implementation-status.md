# Implementation status — pointer

This document is not authoritative and is no longer the repository’s current
status record. See [`CURRENT_STATUS.md`](CURRENT_STATUS.md), which is the
canonical current implementation and release snapshot.

The former detailed status record is preserved in Git history.

The current production Stage 1 security closeout is recorded in
[`docs/release-readiness.md`](release-readiness.md). It records PASS for
release SHA `2c7304916c191c66907d9582a3e7c26225c6eb59`, migration state through
`0024`, tenant isolation/RLS, `app_runtime`, OWNER/MFA, and production
health/readiness. The historical Stage 1 failure is superseded. The
`job_runtime` password was rotated without exposing the replacement
credential; post-rotation sessions were `0`; the deployed web app uses
`app_runtime`; no active `job_runtime` consumer was found; and health,
readiness, and normal authenticated application load passed. Temporary
quarantine is effective and controlled release may proceed with a documented
security exception. `job_runtime` is not fully remediated: provider-level
permanent hardening remains mandatory, and the role must remain unbound until
that hardening completes. This does not claim `0025` is applied or final
production release readiness.

## Expenses backend (A6) - 2026-10-18

Expenses backend only (no UI): migration `0035_expenses` plus the bounded follow-up migrations `0039_expense_attachments` and `0040_recurring_cost_adjustments` (forced RLS, append-only approvals, recognition and correction ledger, state/settlement guard triggers, eleven existing `expense.*` permissions), `src/modules/expenses`, `POST /api/expenses/commands` (including append-only recurring recognition adjustments) and `GET /api/expenses/list|summary|reference`. Recognition is separate from settlement; direct inventory cost is refused. Private expense evidence uses the existing R2 path, and management reports consume recognition movements with operating/fixed-cost classification and lineage. Database/R2 integration validation remains environment-gated. Decisions and open accountant/client questions: [`ADR-019`](decisions/ADR-019-expenses-backend.md). Remaining: UI, cash-module disbursement command for expense settlements, business-day/period locking, and tax treatment.

## Purchase orders backend - 2026-10-19

Purchase-order part of ADR-018 (backend only, no UI): migration `0036_purchase_orders` (orders, lines, append-only revision snapshots, delivery link table, forced RLS, state/link guard triggers, four `purchase_order.*` permissions), `src/modules/purchasing`, `POST /api/purchasing/commands` (CreatePurchaseOrder, SubmitPurchaseOrder, ApprovePurchaseOrder, AmendPurchaseOrder, CancelPurchaseOrder, ClosePurchaseOrder, LinkDeliveryToPurchaseOrder, UnlinkDeliveryFromPurchaseOrder; idempotency keys, expected versions, signed audit, no step-up) and `GET /api/purchasing/list|detail|reference`. Received state, over-receipt and open litres are derived from confirmed linked deliveries; an order has no accounting effect. Remaining: UI, `supplier.delivery.link` permission swap, tolerance policy on over-receipt (other work item), purchase-order versus invoice price variance read model.


## Purchasing supplier side - 2026-10-19

Supplier-side part of ADR-018 (backend only, no UI): migration `0037_supplier_invoice_lines_and_policy` (mandatory `fuel_deliveries.supplier_id`, `supplier_document_lines`, delivery-link coverage facts with a partial unique index, `purchasing_policies` with per-supplier overrides and revision snapshots, append-only `delivery_supplier_corrections`, forced RLS, guard triggers, `supplier.delivery.link` and `purchasing.policy.manage`). `CreateDelivery` requires a supplier and `ConfirmDelivery` refuses a legacy delivery without one; `CorrectDeliverySupplier` is a named command refused once a posted supplier document references the delivery. `SubmitSupplierDocument` takes lines (header must equal the lines exactly, VAT none/exclusive/inclusive from the policy, no hard-coded rate); `PostSupplierDocument` locks deliveries in id order, enforces one posted invoice per delivery allocation (credit notes exempt) and applies the configurable tolerances (flag or require approval). `SetPurchasingPolicy` (high-risk) and read endpoints `GET /api/suppliers/exposure`, `/variance`, `/policy`. Evidence: unit tests for policy, VAT and variance arithmetic and `tests/integration/purchasing-supplier-side.test.ts` (cross-tenant, wrong supplier, duplicate coverage, concurrency, A4 unchanged, VAT modes, policy-driven variance, exposure as-of and reversal, RLS, audit). Follow-ups: the delivery and supplier-invoice screens must send `supplierId` and `lines`; the default `requireInvoiceLines = true` affects existing header-only clients. See the ADR-018 implementation notes (supplier side).
ADR-018 purchasing follow-ups (migration `0038_supplier_document_reference_reuse`): `GET /api/inventory/suppliers` (id, code, name of ACTIVE suppliers, `inventory.delivery.manage`) now feeds the delivery form instead of the creditor-gated summary; the invoice price check uses the linked purchase-order line price when there is one (falls back to receipt cost) and the variance read reports `priceBasis`; posted credit notes net the billed quantity/amount in the exposure read (clamped at zero and shown, one-active-invoice rule unchanged); a corrected invoice may reuse the reference of a REVERSED document (partial unique index, plain 409 on a live duplicate); over-receipt beyond the policy tolerance is flagged in the variance read with the tolerance action, never blocking the delivery. Evidence: `variance.test.ts` and `tests/integration/purchasing-supplier-side.test.ts`. See the ADR-018 follow-up section.

- Profit page (`/profitability`): plain-language profit for a chosen period (this month by default) from the management report. Sales, cost of fuel, expenses and profit; by station; sales by fuel. Missing fuel cost shows "Not available", never zero. The backend now also exposes exact-decimal profit by fuel type; the locked page has not been redesigned.

- Provider payouts page: added "Record a provider statement" (new read-only GET /api/settlements/provider-accounts for accounts and permissions), smarter match prefill and preselection, plain-language wording.

- Expenses page (`/expenses`): plain-language overview (spent this month, by kind, waiting for approval, not paid yet), searchable and filterable list with expandable rows, enter an expense, approve/reject, record, record a payment (bank or reimbursement), cancel with reason, undo a payment, and simple kind-of-expense setup. `GET /api/expenses/reference` now also returns what the caller may do (`capabilities`). Gap: paying from the till needs a cash-module disbursement command that does not exist yet; recurring costs, spending policy thresholds and per-expense approver names are not in the UI.

- Purchasing UI (/purchasing, /purchasing/[purchaseOrderId]): plain-language purchase orders (create/change/approve/cancel/close/link delivery), "Not invoiced yet" view, "Invoice checks" view and purchasing settings (company and per supplier, with identity check on save). Unit/render tests added; not yet verified in a signed-in browser.

- Finance UI decisions (October 2026): the Expenses, Profit and Purchase orders sidebar entries stay. Expenses and Profit were redesigned to match Cash & Banking (summary cards, Filters dropdown with Apply/Cancel, shorter wording); their phone layouts were checked in a browser. The other Finance, purchasing, inventory and supplier screens are owner-approved and locked, so do not restyle them. Tax treatment, spending-limit thresholds and over-receipt tolerance must be configurable settings, not hard-coded values. No pull request is planned for `codex/clerk-only-auth-20261017`. Still open: till payment for expenses, finance-wide period locking, tax treatment, and environment-gated database/R2 validation; recurring recognition, evidence links, expense reporting, fuel-profit calculation and browser export backends are now prepared in the bounded candidate.
