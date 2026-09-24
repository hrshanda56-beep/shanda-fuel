# A7 supplier, purchasing and creditor domain preparation

This document records the parallel-phase design only. It does not create a canonical migration or claim PostgreSQL persistence.

## Scope and ownership

This branch prepares supplier purchasing and creditor contracts. A4 remains authoritative for physical deliveries, accepted litres, delivery allocations, inventory movements, and inventory quantity. A supplier document may reference A4 delivery or allocation identities, but never creates or rewrites inventory movements.

The repository's older workstream board labels commercial ownership as A6 and reporting as A7. The assigned branch prompt explicitly assigns supplier-creditors to A7. Integration must resolve that ownership before productionization; this branch avoids changing the coordination board.

## Prepared domain

- `Supplier` is a tenant-scoped master record.
- `SupplierDocument` represents an invoice or credit note. It stores commercial reference, dates, currency, amount, state, and optional A4 delivery references.
- `SupplierPayment` is an independent payment event. It does not create an invoice, expense, or inventory movement.
- `PaymentAllocation` links a posted payment to a posted payable document and is bounded by both payment capacity and document outstanding amount.
- `SupplierLedgerMovement` is append-oriented. Invoice and payment-reversal movements increase payable balance; credit-note and payment movements decrease it. Balances are derived, not stored as mutable totals.
- Finalized records use named transitions and reversal paths; normal edit/delete is not represented.

## PostgreSQL design for later productionization

The following tables are design intent only. A0 must assign the migration number after the preceding commercial migration is merged.

1. `app.suppliers`
   - `id`, `tenant_id`, `code`, `legal_name`, `status`, timestamps, version.
   - Unique `(tenant_id, id)` and `(tenant_id, code)`.
   - RLS through the tenant context; disabled suppliers remain queryable for history.
2. `app.supplier_documents`
   - `id`, `tenant_id`, `legal_entity_id`, `supplier_id`, `document_type`, `reference_number`, `document_date`, nullable `due_date`, `currency`, `amount`, `state`, version, submitted/posted/reversed provenance.
   - Composite tenant-safe FKs to supplier, legal entity, and memberships.
   - Unique `(tenant_id, supplier_id, reference_number)` where the final accounting policy confirms reference uniqueness.
   - Checks for positive amount, valid date order, supported state/type, and non-null currency.
3. `app.supplier_document_delivery_refs`
   - `id`, `tenant_id`, `legal_entity_id`, `supplier_document_id`, `station_id`, `delivery_id`, nullable `allocation_id`.
   - Composite tenant/station FKs to A4 delivery and allocation rows; unique document/source reference.
   - No inventory columns and no write path into A4.
4. `app.supplier_payments`
   - `id`, `tenant_id`, `legal_entity_id`, `supplier_id`, `payment_date`, `currency`, `amount`, external/reference metadata, state, version, provenance.
   - Positive amount and tenant-safe supplier/membership FKs.
5. `app.supplier_payment_allocations`
   - `id`, `tenant_id`, `supplier_id`, `payment_id`, `document_id`, `amount`, created/reversed provenance.
   - Positive amount, same-tenant/supplier composite FKs, and an append-oriented reversal link rather than destructive deletion.
   - Database trigger or command transaction must enforce allocation capacity under deterministic payment/document locks.
6. `app.supplier_account_movements`
   - `id`, `tenant_id`, `supplier_id`, `currency`, movement type, positive amount, source type/id, posted timestamp, reversal link, actor/request provenance.
   - Append-only privileges/policies; immutable after posting; unique source reference for idempotent posting.

Idempotency should use the platform-owned facility when available. The current A3 idempotency table is not silently adopted as a supplier-owned persistence contract.

## Deferred decisions

- One invoice covering multiple deliveries and one delivery split across documents are structurally supported but require final policy confirmation.
- Credit terms/default due dates, payment approval thresholds, tax/VAT treatment, landed-cost components, and currency conversion are not invented here.
- Weighted-average costing, inventory valuation, and A4 movement changes are explicitly outside this slice.
- No canonical migration, Drizzle snapshot, central permission registration, production route, or persistence adapter is included.

## Permissions to register during productionization

`supplier.view`, `supplier.manage`, `supplier.document.create`, `supplier.document.post`, `supplier.payment.create`, `supplier.payment.post`, `supplier.payment.allocate`, `supplier.payment.reverse`, and `supplier.creditor.review`.

High-risk posting/reversal permissions should use the existing strong-auth and approval conventions. Exact role/scope assignments remain an A1/integration decision.

## Integration test plan after persistence exists

- Fresh migration and schema constraints with synthetic PostgreSQL data.
- Tenant A cannot read, link, allocate, or export Tenant B supplier records.
- Composite FK rejection for cross-tenant/legal-entity/station delivery references.
- Duplicate supplier reference behavior.
- Invoice/payment state transitions and immutable posted records.
- Exact decimal amount/scale validation and one-currency balance derivation.
- Payment allocation cap under concurrent requests with deterministic locks.
- Cross-supplier allocation rejection.
- Payment reversal atomically creates compensating movement and reopens payable exposure.
- Idempotent retries and changed-payload idempotency conflicts.
- Signed audit and outbox behavior in the same transaction.
- Later API/E2E coverage for supplier document entry, payment allocation, approval, aging, and statement views.
