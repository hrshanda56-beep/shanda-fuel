-- ADR-018 gap 4: a corrected supplier invoice may be re-submitted under the same reference
-- number once the earlier document has been REVERSED. Duplicate control now applies to
-- non-reversed documents only (invoices and credit notes still share one reference space).
-- Reversed rows are kept untouched; nothing is rewritten.
ALTER TABLE "app"."supplier_documents" DROP CONSTRAINT "supplier_documents_tenant_supplier_reference_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_documents_tenant_supplier_reference_uidx" ON "app"."supplier_documents" USING btree ("tenant_id","supplier_id","reference_number") WHERE "state" <> 'REVERSED';
