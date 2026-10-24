# Permission catalogue

The centralized permission catalogue is implemented in `src/platform/security/permissions.ts` and exposed through the authorization module. A3 adds narrowly scoped forecourt and reconciliation codes for business-day/shift, meter, price-boundary, reconciliation, approval, and exception commands. Codes—not role-name checks—remain authoritative.

Permission codes, not role-name checks, are authoritative. Role templates only expand to permission codes and every assignment carries an explicit tenant/legal-entity/station scope and optional expiry.

High-risk permission codes additionally require a current strong-authenticated session with a verified server-side assertion; timestamps alone never satisfy the gate. Step-up authentication is enforced by the session contract for commands that require it. Temporary grants are time-bounded, revocable, and do not widen tenant scope.

The canonical seed tables and RLS relationships are in `src/platform/db/migrations/0002_a1_tenant_authorization_security.sql`. The architecture SQL at [`architecture/a1-platform-security-migration.sql`](architecture/a1-platform-security-migration.sql) is reference-only and is never executed by tests or deployment.

Owner is a scoped role template, not an authorization bypass. Named role-mutation commands reject self-elevation, require an explicit ownership-transfer confirmation for granting OWNER, and preserve the last active owner.

The stable `PERMISSION_CODES` and server authorization result are the A2 integration seam. UI code consumes a typed projection of that result and does not import or reimplement authorization rules.

Expense permissions (`expense.view`, `expense.submit`, `expense.approve`, `expense.post`, `expense.reverse`, `expense.payment.record`, `expense.payment.reverse`, `expense.manage`, `expense.policy.manage`, `expense.recurring.manage`, `expense.recurring.recognize`) are registered by migration `0035_expenses`. `expense.reverse`, `expense.payment.reverse` and `expense.policy.manage` are high-risk; approval, posting and settlement need step-up at or above the configured threshold (always, when none is configured). See ADR-019.

Purchase-order permissions are registered by migration `0036_purchase_orders` (ADR-018): `purchase_order.view` (list/detail/reference), `purchase_order.create` (create, submit, amend, and link or unlink deliveries), `purchase_order.approve` (approve; the submitter or last amender cannot approve while another approver exists), and `purchase_order.cancel` (cancel or close). Grants: OWNER, ADMINISTRATOR and FINANCE hold all four; SUPERVISOR holds view and create; ATTENDANT none. None is high-risk: a purchase order has no accounting effect (no ledger, inventory, cash, or bank write), so no purchase-order command requires step-up, including cancelling an approved order. Linking uses `purchase_order.create`; it can move to `supplier.delivery.link` when that code lands.

Supplier-side purchasing permissions are registered by migration `0037_supplier_invoice_lines_and_policy` (ADR-018): `supplier.delivery.link` (tie a delivery to a supplier invoice, and correct the supplier recorded on a delivery via `CorrectDeliverySupplier`, which also needs `inventory.delivery.manage`) is held by OWNER, ADMINISTRATOR and FINANCE and is not high-risk; `purchasing.policy.manage` (set tolerances, VAT configuration and the invoice-lines rule via `SetPurchasingPolicy`) is high-risk, so it always needs a current step-up, and is held by OWNER and ADMINISTRATOR. The exposure and variance reads reuse `supplier.creditor.review`; the policy read uses `supplier.view`.
