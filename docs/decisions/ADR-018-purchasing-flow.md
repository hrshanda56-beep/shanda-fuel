# ADR-018: Purchasing flow (purchase order, delivery, supplier invoice linkage)

- Status: Accepted (2026-10-19). Purchase order part (D4, D5-PO) implemented in migration 0036; the delivery supplier, invoice lines, and tolerance/VAT policy parts are owned by other work items (see below).
- Date: 2026-10-18
- Owner: A6 Commercial with A4 Inventory (delivery seam) and A7 Reporting (unbilled exposure read model)

Implementation is deferred until the expenses migration (0035) has landed. The migration number for this work is assigned by A0 afterwards and must not be guessed here.

## Decisions confirmed by the user 2026-10-19

- Purchase orders exist in V1.
- The supplier is mandatory on a delivery (the column and its enforcement belong to the delivery/invoice work item, migration 0037; the purchase-order link command compares the supplier once that column exists).
- Supplier invoices have lines.
- Tolerance and variance rules, and VAT, are customizable policy, never hard-coded. The purchase-order read side only exposes numeric over- and under-receipt litres; it applies no tolerance.

### Purchase order implementation notes (migration `0036_purchase_orders`)

- Tables `app.purchase_orders`, `app.purchase_order_lines`, `app.purchase_order_revisions` (append-only snapshots) and `app.purchase_order_delivery_links`. The link table replaces the nullable `purchase_order_id` column proposed on `fuel_deliveries`, so no A4 table is altered. Composite tenant FKs, forced RLS, runtime grants without delete.
- Deviation from D4: a purchase order is station-scoped (station mandatory) rather than optionally multi-station. This lets separation of duties and authorization use the same station scope as the other modules; a multi-station order is one order per station.
- Amendment is a new revision: lines keep identity and product, quantities and price change through `AmendPurchaseOrder`, removal is a status change, and every revision stores a full snapshot. Amending an APPROVED order returns it to SUBMITTED for re-approval and makes the amender the submitter for separation of duties.
- PARTIALLY_RECEIVED and RECEIVED are derived on read from CONFIRMED linked deliveries (`actual_quantity_litres`); nothing stores or sets them. `ClosePurchaseOrder` records short-closed litres per line. A purchase order with confirmed deliveries must be closed, not cancelled.
- No purchase-order command requires step-up: the order has no accounting effect, so even cancelling an approved order carries no financial risk. Linking and unlinking use `purchase_order.create` until `supplier.delivery.link` lands.

## Context

The Blueprint requires that physical delivery, supplier invoice, supplier account movement and supplier payment are separate objects (section 8.1), that a supplier invoice never rewrites physical delivery quantity (sections 7.4, 8.1 and the open-question list), and that fuel arriving before its invoice produces "unbilled exposure" (8.1). Workstreams A4 and A6 repeat these as forbidden modifications ("using supplier invoice quantity as physical receipt authority", "invoices rewriting delivery quantity").

The `src/modules/purchasing` and `src/modules/deliveries` modules are empty boundaries (`export {}`). Today the pieces exist in two other places, listed below, and the link between them is thin. This ADR records what exists, what is missing, and a design for the missing part.

### What the Blueprint says, and what it does not

The word "purchase order" does not appear anywhere in `MASTER_BLUEPRINT.md` or `WIREFRAMES.md`. The Blueprint names "purchasing" only as a module in the module list and as "purchasing/creditor contract" in A4. The Appendix A aggregates for suppliers are Supplier, Supplier Invoice, Supplier Payment, Supplier Credit Note. The Appendix B supplier commands are SubmitSupplierInvoice, PostSupplierInvoice, SubmitSupplierPayment, PostSupplierPayment, ReverseSupplierPayment. The Appendix B delivery commands are RecordArrival, BeginOffloading, ConfirmReceipt, PostDelivery.

Consequence: a Purchase Order is a design extension, not a locked requirement. This ADR proposes it as an optional, non-financial commercial intent record. If the client does not want it, sections "Purchase order" below can be dropped without changing the delivery/invoice linkage design. See open questions.

## What already exists (verified in the repository)

### Supplier and creditor ledger (A7 creditors, migration with `app.suppliers` ... `app.supplier_account_movements`)

Schema `src/platform/db/schema/a7.ts`:

- `app.suppliers` (tenant master, code unique per tenant).
- `app.supplier_documents`: `document_type` INVOICE or CREDIT_NOTE, `reference_number`, document/due date, USD amount, state DRAFT/SUBMITTED/POSTED/PARTIALLY_PAID/PAID/REVERSED, version, provenance. Unique `(tenant_id, supplier_id, reference_number)` (duplicate control, shared across invoices and credit notes and including REVERSED rows).
- `app.supplier_document_delivery_refs`: composite tenant/station FKs to `fuel_deliveries` and optional `fuel_delivery_allocations`. Unique per `(document, delivery, allocation)` only.
- `app.supplier_payments`, `app.supplier_payment_allocations`, append-only `app.supplier_account_movements` (reversal link, source uniqueness).

Commands `src/modules/creditors/commands.ts` and `POST /api/suppliers/commands`: CreateSupplier, SubmitSupplierDocument (accepts `deliveryReferences`), PostSupplierDocument (writes the INVOICE or CREDIT_NOTE movement, no inventory write), ReverseSupplierDocument (invoices only; compensating ADJUSTMENT movement and allocation reversal), SubmitSupplierPayment, PostSupplierPayment, AllocateSupplierPayment, ReverseSupplierPayment. Read endpoints: `/api/suppliers/summary`, `/api/suppliers/statement`, aging in `creditors/queries.ts`.

Permissions already in the catalogue (`src/platform/security/permissions.ts`): supplier.view, supplier.manage, supplier.document.create/post/reverse, supplier.payment.create/post/allocate/reverse, supplier.creditor.review. Approval and expected-version policy per command is in `SUPPLIER_COMMAND_POLICY`.

### Physical delivery and costing (A4 inventory, `src/platform/db/schema/a4.ts`, `src/modules/inventory`)

- `app.fuel_deliveries`: station, product, delivery note number (unique per station), delivered_at, business date, `note_quantity_litres` (commercial claim), `actual_quantity_litres`, `shortage_excess_litres`, free-text `supplier_reference`, transporter/driver/truck/seal, pre/post dip ids, `status` in DRAFT/CONFIRMED/CANCELLED, optional unit/total landed cost.
- `app.fuel_delivery_allocations`: accepted litres per tank (physical authority).
- Commands (`POST /api/inventory/commands`, permission `inventory.delivery.manage`): CreateDelivery, ConfirmDelivery (atomically posts one DELIVERY inventory movement per allocation), RecordReceiptCost (landed cost per allocation, feeding A12 WAC), RequestInventoryCostRevaluation / Approve / Post for late costs.

### Reporting

Management report reads supplier balances and aging as of a date from the ledger movements. Sale cost and revaluation come from A12 evidence, never from supplier invoices.

## What is truly missing

1. No supplier on a delivery. `fuel_deliveries` has only a free-text `supplier_reference`; there is no `supplier_id` FK. Therefore nothing proves that a delivery referenced from a supplier document belongs to that supplier.
2. No protection against the same delivery (or allocation) being referenced by two posted invoices of the same supplier. Today only `(document, delivery, allocation)` is unique. Two different invoice references covering one delivery is accepted, which is exactly the "duplicate payable" risk for fuel.
3. No unbilled-exposure read model (Blueprint 8.1: posted delivery quantity/value not yet covered by posted invoice allocations). Nothing computes it.
4. No purchase order concept at all (Blueprint is silent).
5. The Blueprint delivery state machine (DRAFT, ARRIVED, VERIFICATION, OFFLOADING, OFFLOADING_INTERRUPTED, RECEIVED_PENDING_CONFIRMATION, CONFIRMED, POSTED, REJECTED, CANCELLED) is implemented only as DRAFT/CONFIRMED/CANCELLED with ConfirmDelivery as the single posting step. Arrival, verification, partial receipt and rejection are A4 scope, not purchasing, and are not designed here.
6. No invoice-versus-delivery variance facts (note quantity vs accepted vs invoiced quantity and price), and no stored invoice line quantities. `supplier_documents` carries only a header amount.
7. No link from a delivery's recorded landed cost (`RecordReceiptCost`) to the supplier invoice that substantiates it. Cost is entered independently; nothing reconciles the two.
8. No HTTP read endpoints for deliveries by supplier or for unbilled exposure, and no UI.

## Decision

Keep the three objects separate and add only linkage and read-side control. Add no new ledger. Specifically:

### D1. Supplier on the delivery

Add a nullable `supplier_id` to `app.fuel_deliveries` with a composite tenant-safe FK, set by a new command (or by CreateDelivery) before confirmation. Nullable because existing rows and spot deliveries pre-date it; a delivery without a supplier cannot be linked to a supplier document and shows as "supplier unassigned" in exposure. Assigning or changing the supplier after a delivery is CONFIRMED is a named, audited correction command (`CorrectDeliverySupplier`), never an edit, and is refused if any posted supplier document references the delivery.

### D2. Delivery-to-invoice coverage table (replaces ad hoc refs for control)

Keep `supplier_document_delivery_refs` as the link record and extend it (or add a sibling) with coverage facts, all optional and informational:

- `invoiced_quantity_litres` (exact litres, 3 dp) and `invoiced_amount` (money, 4 dp) per ref.
- A computed or stored `quantity_variance_litres = invoiced_quantity - accepted_quantity` is a derived read, not a mutation of either side.

Invariants enforced by the post command inside the same transaction as the INVOICE movement, with deterministic locking (delivery rows ordered by id, then the document):

- I1. An invoice never changes `fuel_deliveries.actual_quantity_litres`, allocations, inventory movements or cost events. The creditors module has no write access to A4 tables; a test asserts row counts of A4 tables are unchanged by submit, post and reverse.
- I2. Every referenced delivery must be CONFIRMED, belong to the document's supplier (D1) and legal entity, and match the tenant.
- I3. No duplicate payable: for one supplier, a delivery allocation may be covered by at most one POSTED, non-reversed INVOICE at a time. Enforced by a partial unique index over posted active refs plus a lock-and-check in the command (the index alone cannot see document state if state lives on the parent, so the post command writes an `active` flag on the ref row that is cleared on reversal). Credit notes may reference an already-invoiced delivery and are exempt, because a credit note is a reduction, not a new payable.
- I4. Reference-number duplicate control stays as is. The unique constraint currently blocks re-submitting a corrected invoice with the same reference after reversal; this is a known limitation to decide on (open question 4).
- I5. The invoice movement is the only payable event. Receipt cost (`RecordReceiptCost`) never creates a payable and the invoice never creates inventory value; both remain separate until an explicit reconciliation view compares them.
- I6. Cash and bank are untouched by delivery and invoice. Only supplier payments (existing) reduce the payable, and reach cash/bank through their own domain commands.

### D3. Unbilled exposure (read model only)

A query, no new table: for a supplier and as-of date, sum over CONFIRMED deliveries with a supplier of the accepted litres and, where a landed cost exists, the value, minus the coverage of POSTED active invoice refs. Output states per delivery: UNBILLED, PARTIALLY_BILLED (invoiced quantity or amount below accepted/costed), BILLED, OVER_BILLED (invoiced above accepted, surfaced as a variance exception, never auto-corrected). Value is shown only when a landed cost exists; otherwise the litres are shown and value is "unpriced" (never zero). Exposure is a reporting figure and never a ledger balance (consistent with Blueprint 8.1 and the "approved unbilled supplier exposure" row on line 777).

### D4. Purchase order (optional, non-financial)

Because the Blueprint is silent, the PO is designed as intent only, with no accounting effect:

Table `app.purchase_orders`: id, tenant_id, legal_entity_id, supplier_id, station_id (nullable if multi-station), order_number (unique per tenant), order_date, expected_delivery_date, currency (USD), state, version, provenance. Table `app.purchase_order_lines`: product_id, ordered_litres (3 dp), optional agreed unit price (8 dp, matching landed-cost precision), line number. Optional nullable `purchase_order_id` / `purchase_order_line_id` on `fuel_deliveries` for matching.

State machine: DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED; SUBMITTED/APPROVED -> CANCELLED; DRAFT -> CANCELLED. PARTIALLY_RECEIVED and RECEIVED are derived by the system from confirmed linked deliveries, never set by hand. CLOSED is an explicit command that records short-closed litres. A posted/received PO is corrected by amendment version, not edit.

Commands: SubmitPurchaseOrder, ApprovePurchaseOrder, AmendPurchaseOrder (new version), CancelPurchaseOrder, ClosePurchaseOrder, LinkDeliveryToPurchaseOrder (only to CONFIRMED or DRAFT deliveries of the same supplier and product).

Invariants: a PO creates no payable, no inventory and no cash movement; the delivery's accepted litres, not ordered litres, remain physical authority; over-receipt beyond a policy tolerance is flagged as an exception, not blocked at the dock (the fuel is already in the tank, Blueprint 7.4 quarantine rule). Price differences between PO price, invoice price and landed cost are variance facts shown to Finance.

### D5. Permissions

Reuse the existing catalogue where it fits and add only what is new:

- Existing and unchanged: supplier.view/manage, supplier.document.create/post/reverse, supplier.payment.*, supplier.creditor.review, inventory.delivery.manage.
- Proposed new codes (to be registered by A1/A0, role mapping an integration decision): `purchase_order.view`, `purchase_order.create`, `purchase_order.approve`, `purchase_order.cancel`, `supplier.delivery.link` (linking a delivery or allocation to a document, separate from `supplier.document.create` because it ties a physical record to a payable). `CorrectDeliverySupplier` uses `inventory.delivery.manage` plus `supplier.manage` and requires approval. Unbilled exposure and variance views use `supplier.creditor.review`.
- Posting/approval separation: the user who submits a PO should not approve it (Blueprint approvals default to self-approval off); invoice post keeps `requiresApproval: true` from `SUPPLIER_COMMAND_POLICY`.

### D6. Idempotency, locking, audit

Every new command takes an idempotency key and request hash through the existing command executors, takes row locks in a fixed order (purchase order, deliveries by id, supplier document), writes an audit event in the same transaction, and uses expected-version checks. Posting is the only step that writes a ledger movement. Reversals are named commands creating compensating movements, never deletes.

## Invariants (summary)

1. Delivery accepted litres are authoritative; invoices and POs never alter them or any A4 row.
2. At most one active posted invoice covers a given supplier delivery allocation (no duplicate payable); credit notes are reductions.
3. A PO has no accounting effect. Delivery, invoice, supplier movement, payment, cash and bank remain separate domains.
4. A delivery must be CONFIRMED and belong to the same supplier and tenant to be invoiced.
5. All quantities and money are exact decimals; variance is derived, never stored as a correction of either side.
6. Posted records are corrected by reversal/adjustment commands with reasons and audit.
7. Tenant isolation by composite tenant-aware FKs and RLS on every new table; fail-closed context.

## Tests required when implemented

Cross-tenant link denial; invoice for another supplier's delivery rejected; same delivery on two invoices rejected, credit note allowed; concurrent posts of two invoices over one delivery (exactly one wins); A4 table row counts and delivery quantity unchanged across submit/post/reverse; exact-decimal variance (0.1/0.2 style); PO derived state transitions from confirmed deliveries; over-receipt exception not blocking confirmation; unbilled exposure as-of dates, unpriced litres not zero, reversal reopens exposure; idempotent retry and changed-payload conflict; permission denial per command; audit event presence.

## Alternatives considered

- Make the supplier invoice the receipt authority (accepted quantity from invoice): rejected, forbidden by Blueprint 7.4/8.1 and A4.
- A universal purchases/transactions table combining PO, delivery and invoice: rejected by the locked invariants.
- Post a payable at delivery confirmation (accrual at receipt): rejected as a default because it would create two payables (accrual and invoice) and the Blueprint models fuel-before-invoice as exposure, not a ledger balance. Accrual can be reconsidered if the accountant requires it.
- Skip the PO entirely: viable, since the Blueprint never mentions it. Retained as optional D4.

## Consequences

Closes the duplicate-payable and wrong-supplier gaps with small additive changes, and delivers the exposure figure the Blueprint promises without a new ledger. Adds a nullable column to an A4 table, which requires A4 owner agreement and an A0-sequenced migration. The PO adds a module and screens that the client may not need.

## Affected modules

`src/modules/creditors` (document link validation, new coverage fields), `src/modules/inventory` (supplier on delivery, read-only), new `src/modules/purchasing` (PO), `src/modules/reporting` (exposure), `src/platform/security/permissions.ts` (new codes), schema `a4.ts`/`a7.ts`, one new migration after 0035.

## Specification impact

Refines the Blueprint for section 8.1 unbilled exposure and duplicate control. The PO (D4) and the extra permission codes are additions where the Blueprint is silent; if kept they should be confirmed with the client and noted in the Blueprint appendices.

## Migration/backward compatibility

All schema changes are additive and nullable (`fuel_deliveries.supplier_id`, coverage columns, PO tables). Existing deliveries stay valid and appear as "supplier unassigned". Existing posted invoices with delivery refs need a backfill review: where two posted invoices already cover one delivery, flag for Finance rather than rewriting. Rollback is to stop reading the new columns; no existing data is rewritten.

## Where the Blueprint is silent (decisions to confirm)

1. Whether purchase orders exist in V1 at all, their approval thresholds, and amendment rules.
2. Whether a delivery has a mandatory supplier, and how spot or inter-station deliveries without a supplier are treated.
3. Invoice lines: whether invoices are captured per product and quantity or as a header amount only (today header only).
4. Resubmitting a corrected invoice with the same reference after a reversal (current unique constraint forbids it).
5. Tolerance policy for over-receipt, over-billing and price variance, and who resolves the variance.
6. Whether unbilled exposure is valued at PO price, recorded landed cost, or left unpriced; and any accrual to the ledger.
7. Tax/VAT treatment of invoices and landed-cost components (not invented).
8. Whether a credit note must reference an invoice or delivery.
9. Currency: schema checks pin USD; multi-currency is not designed.
10. Document evidence requirements (attached delivery note and invoice scan) for posting an invoice.
11. Role mapping for the new permission codes.

## Implementation notes (supplier side)

Delivered by migration `0037_supplier_invoice_lines_and_policy` with the code in `src/modules/creditors` (`purchasing-policy.ts`, `variance.ts`, `purchasing-persistence.ts`, `purchasing-queries.ts`), `src/modules/inventory/commands.ts` and the supplier routes. Decisions taken by the client: the supplier is mandatory on a delivery, supplier invoices have lines, and tolerances and VAT are configuration. This section records how D1, D2, D3 and the supplier-side part of D5 were realised and where the implementation deliberately differs from the design text above.

**D1, supplier on the delivery.** `fuel_deliveries.supplier_id` with a composite `(tenant_id, supplier_id)` FK. `CreateDelivery` requires `supplierId` (existing and ACTIVE in the tenant, otherwise a plain 404/409) and `ConfirmDelivery` refuses a delivery with no supplier. Legacy rows stay NULL and read as "supplier unassigned". `CorrectDeliverySupplier` (inventory route) is a named, audited command: it needs `inventory.delivery.manage` (high-risk, so a current step-up) plus `supplier.delivery.link`, a reason, locks the delivery row, refuses if any POSTED, PARTIALLY_PAID or PAID supplier document references the delivery, writes the append-only `delivery_supplier_corrections` row and changes only `supplier_id`. Confirmed deliveries stay immutable: the `fuel_deliveries` guard trigger was widened to allow exactly that one column, only when the command has said so (a transaction-local setting) and no posted document references the delivery. "Approval" is the high-risk step-up plus the mandatory reason; the repository has no generic second-approver mechanism for it, so none was invented.

**D2, coverage.** `supplier_document_delivery_refs` gains `document_type`, `invoiced_quantity_litres`, `invoiced_amount`, `active`, `released_at` and `needs_finance_review`. Refs are written inactive at submission and activated by `PostSupplierDocument` after the document is POSTED; reversal clears `active`. The runtime role keeps no UPDATE on the table except a column grant on `(active, released_at)`, and a trigger rejects any other change. A partial unique index `(tenant_id, delivery_id, coalesce(allocation_id, nil))` over `active AND document_type = 'INVOICE'` is the backstop for I3; the command also checks overlap (a whole-delivery link overlaps every allocation link). Credit notes are exempt. Posting locks the referenced deliveries in id order, then the document, and verifies each delivery is CONFIRMED, of the same supplier and the same legal entity (also enforced by a DB trigger). Submission performs the same checks early so the user gets a plain message; posting is authoritative. Backfill: existing posted invoice refs are activated; where two posted invoices already covered one delivery the earliest keeps coverage and the rest are flagged `needs_finance_review` (nothing is rewritten). I1 is covered by tests that compare A4 row counts and quantities across submit, post and reverse.

**Invoice lines.** New `supplier_document_lines` (line number, optional product, description, quantity 3 dp, unit price 8 dp, net 4 dp, VAT rate and amount, gross, optional delivery link). The header amount (the payable) must equal the sum of line gross exactly; optional header net and VAT figures are checked against the lines. Lines may point at one of the document's delivery links, which then supplies `invoiced_quantity_litres` and `invoiced_amount` (net). Legacy header-only submission is accepted only when the policy sets `requireInvoiceLines` to false. The effective default, including a tenant that has never saved a policy, is `requireInvoiceLines = true`; this is a behaviour change for existing header-only clients (see open items).

**Customizable policy (D2 tolerance, open questions 3, 5, 7).** `purchasing_policies` holds one tenant row plus optional per-supplier overrides that inherit every field they leave unset; `purchasing_policy_revisions` snapshots each version. `SetPurchasingPolicy` needs `purchasing.policy.manage` (high-risk), a reason, and an expected version when changing an existing policy. Fields: quantity tolerance (litres and percent), price tolerance (percent), amount tolerance, over-receipt tolerance (litres and percent), the action when exceeded (`FLAG` or `REQUIRE_APPROVAL`), VAT mode (`NONE`, `EXCLUSIVE`, `INCLUSIVE`), a default VAT rate, per-product VAT rates, and `requireInvoiceLines`. Nothing is hard-coded: with no policy the system is strict (zero tolerance, flag only), VAT-free and requires lines. No Zimbabwe tax treatment is invented; VAT is data. Rules, documented in the pure functions and covered by unit tests: allowed difference is the greater of the absolute and percent tolerance; the boundary is inclusive; an unset tolerance is zero. VAT: EXCLUSIVE treats the printed line amount as net and adds VAT, INCLUSIVE treats it as gross and derives net, VAT rounds half-up to 4 dp at one boundary per line and the other component is derived by subtraction, so net plus VAT equals gross exactly; a VAT amount printed on the invoice overrides the computed figure. Rate precedence: line, product override, default. At posting, `FLAG` stores `variance_status = FLAGGED` with a snapshot of the findings; `REQUIRE_APPROVAL` refuses the post unless a `varianceApprovalReason` is supplied by someone other than the submitter, then stores `APPROVED`. Only invoice-side findings (over-billed litres, price above receipt cost, amount above expected) gate posting; over-receipt and short receipt are reported but never block, in line with the quarantine rule.

**D3, exposure and variance reads.** `GET /api/suppliers/exposure` returns UNBILLED, PARTIALLY_BILLED, BILLED or OVER_BILLED per delivery with a supplier-unassigned bucket and an as-of date (an invoice covers a delivery as of the date when it is dated on or before it and was not yet reversed, by UTC reversal date, so a reversal reopens exposure from the day it happens). Value is shown only where a receipt cost exists; otherwise litres are shown as unpriced, never zero. `GET /api/suppliers/variance` compares delivery note, accepted and invoiced litres and the invoiced unit price against the recorded receipt cost, applies the resolved policy and returns plain-language reasons. `GET /api/suppliers/policy` reads the policy. All three use `supplier.creditor.review` (policy read: `supplier.view`).

**D5, permissions.** Added `supplier.delivery.link` (held by OWNER, ADMINISTRATOR, FINANCE; required in addition to `supplier.document.create` when a document carries delivery links, and for `CorrectDeliverySupplier`) and `purchasing.policy.manage` (high-risk; OWNER and ADMINISTRATOR). The purchase-order link command still uses `purchase_order.create`.

**Known limits and open items.** (1) Closed by follow-up 2 below (PO price basis). (2) Closed by follow-up 4 below (reference reuse after reversal). (3) The inventory and supplier screens were not changed: the delivery form must now send `supplierId` and the supplier invoice form must send `lines`, or those calls are refused with a plain message. (4) Closed by follow-up 3 below (credit notes now net billed exposure). (5) Multi-currency and evidence attachments remain out of scope.

## Follow-up (purchasing gaps closed 2026-10-19, migration `0038_supplier_document_reference_reuse`)

1. **Supplier list for receiving.** `GET /api/inventory/suppliers?tenantId&stationId` returns `{ data: [{ id, code, name }] }` for ACTIVE suppliers of the tenant, ordered by name. It is authorized by `inventory.delivery.manage` at the station (the permission `CreateDelivery` uses) on top of the station read authority, so receiving staff need no creditor access; no balances, documents or other fields are exposed, and other tenants' suppliers are invisible. The delivery form in `inventory-workspace.tsx` now reads this endpoint instead of `/api/suppliers/summary` (which needs `supplier.creditor.review`). Code: `queryDeliverySuppliers` in `src/modules/inventory/queries.ts`.
2. **Price basis.** When a delivery has an ACTIVE `purchase_order_delivery_links` row whose PO line has an `agreed_unit_price`, the invoice unit price is compared with that PO price using the policy's price tolerance (percent, greater-of rule, inclusive boundary). With no link, or a link to a line without an agreed price, the check falls back to the recorded receipt cost; with neither, it is skipped as "unpriced, not zero". New finding codes `PRICE_ABOVE_PO_PRICE` (exception, gates posting under `REQUIRE_APPROVAL`) and `PRICE_BELOW_PO_PRICE` (information). The variance read (`GET /api/suppliers/variance`) returns `priceBasis` (`PURCHASE_ORDER`, `RECEIPT_COST` or null), `purchaseOrderNumber`, `purchaseOrderUnitPrice`, and `priceDifference` against the basis actually used; the posting snapshot carries the same findings. The receipt-cost figure is still returned as `receiptUnitCost`. Decision: the PO price replaces the receipt cost as the basis rather than checking both, to avoid two contradictory price findings for one invoice line; the receipt-versus-PO difference itself is visible in the same read.
3. **Credit notes net billed exposure.** Posted, non-reversed credit notes covering a delivery now reduce the billed figures in `GET /api/suppliers/exposure`: `netBilledLitres = max(invoiced - credited, 0)` and `netBilledAmount` likewise (null when the invoice states no amount), the coverage state and `unbilledLitres`/`unbilledValue` are computed from the net figure (so a fully credited delivery is exposed again), and `invoicedLitres`, `creditedLitres`, `invoicedAmount`, `creditedAmount` are shown. A credit larger than the invoices is clamped to zero and reported with `creditExceedsInvoiced`, `unappliedCreditLitres` and a plain-language note, never silently negative. A credit note without stated litres covers the whole accepted quantity, as before. The one-active-invoice-per-delivery rule, its index and credit-note exemption are unchanged. The variance read adds an informational `creditedLitres`; variance findings still judge the invoice itself.
4. **Reference reuse after reversal (open question 4).** Migration 0038 replaces the table constraint `supplier_documents_tenant_supplier_reference_uidx` with a partial unique index of the same name over `(tenant_id, supplier_id, reference_number) WHERE state <> 'REVERSED'`. Invoices and credit notes still share one reference space; a corrected invoice can be re-submitted under the reference of a REVERSED document, the reversed row is kept as evidence, and nothing is rewritten. `SubmitSupplierDocument` now checks first and answers 409 with a plain message instead of a raw constraint error. Migration 0037 was not edited.
5. **Over-receipt.** `assessOverReceipt` applies the policy's over-receipt tolerance (litres and percent, greater-of, inclusive boundary) to accepted litres versus the delivery note. The variance read returns, per delivery, `overReceipt` (`flagged`, `excessLitres`, `allowedLitres`, `action`, `reviewRequired`) or null, `overReceiptReviewRequired`, and the `OVER_RECEIPT` finding, independent of whether an invoice or an allocation-only invoice link exists. The delivery is never blocked or changed: `FLAG` marks it, `REQUIRE_APPROVAL` sets `reviewRequired` so Finance resolves it. Over-receipt still never gates invoice posting. `ConfirmDelivery` is unchanged (it does not read the purchasing policy).

Evidence: unit tests in `src/modules/creditors/variance.test.ts` (price basis, credit netting, over-receipt) and five new cases in `tests/integration/purchasing-supplier-side.test.ts` (supplier list authorization and scoping, PO price basis and tolerance, credit netting and clamp, reference reuse including the database index, over-receipt flag and action).
