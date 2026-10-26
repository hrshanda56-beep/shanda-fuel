-- Which station a supplier invoice is for, and what each invoice line is for. Both are optional
-- and nullable, so existing invoices and API callers keep working: no station means the invoice
-- is not tied to one, and no line type means the line was entered before types existed.
-- A fuel line names its product (product_id, already on the line); transport and other direct
-- costs are lines with no product.
ALTER TABLE "app"."supplier_documents" ADD COLUMN "station_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_station_fk"
  FOREIGN KEY ("tenant_id","legal_entity_id","station_id")
  REFERENCES "app"."stations"("tenant_id","legal_entity_id","id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD COLUMN "line_type" text;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD CONSTRAINT "supplier_document_lines_line_type_ck"
  CHECK ("line_type" IS NULL OR "line_type" IN ('FUEL','TRANSPORT','OTHER_DIRECT_COST'));
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD CONSTRAINT "supplier_document_lines_line_type_product_ck"
  CHECK ("line_type" IS NULL OR "line_type" = 'FUEL' OR "product_id" IS NULL);
