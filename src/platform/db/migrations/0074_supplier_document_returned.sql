-- A submitted supplier invoice or credit note can be sent back before it is posted, with a reason.
-- RETURNED is terminal and kept for history. Like REVERSED, it no longer holds the supplier's
-- reference number, so the corrected document can be entered again under the same reference.
ALTER TABLE "app"."supplier_documents"
  ADD COLUMN "returned_by" uuid,
  ADD COLUMN "returned_at" timestamp with time zone,
  ADD COLUMN "return_reason" text;
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" DROP CONSTRAINT "supplier_documents_state_ck";
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_state_ck"
  CHECK ("state" in ('DRAFT','SUBMITTED','POSTED','PARTIALLY_PAID','PAID','REVERSED','RETURNED'));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_return_provenance_ck"
  CHECK ("state" <> 'RETURNED' OR ("returned_by" IS NOT NULL AND "returned_at" IS NOT NULL
    AND btrim(coalesce("return_reason", '')) <> '' AND "posted_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_returned_by_fk"
  FOREIGN KEY ("tenant_id","returned_by") REFERENCES "app"."memberships"("tenant_id","id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "app"."supplier_documents_tenant_supplier_reference_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_documents_tenant_supplier_reference_uidx"
  ON "app"."supplier_documents" USING btree ("tenant_id","supplier_id","reference_number")
  WHERE "state" NOT IN ('REVERSED','RETURNED');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.a7_supplier_document_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state NOT IN ('DRAFT', 'SUBMITTED') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
    NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR
    NEW.document_type IS DISTINCT FROM OLD.document_type OR
    NEW.reference_number IS DISTINCT FROM OLD.reference_number OR
    NEW.document_date IS DISTINCT FROM OLD.document_date OR
    NEW.due_date IS DISTINCT FROM OLD.due_date OR
    NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.amount IS DISTINCT FROM OLD.amount
  ) THEN
    RAISE EXCEPTION 'finalized supplier document facts are immutable';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'draft supplier documents must be submitted before posting';
  END IF;
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED', 'DRAFT', 'POSTED', 'RETURNED') THEN
    RAISE EXCEPTION 'submitted supplier documents have an invalid transition';
  END IF;
  IF OLD.state IN ('POSTED', 'PARTIALLY_PAID') AND NEW.state NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'REVERSED') THEN
    RAISE EXCEPTION 'posted supplier documents have an invalid transition';
  END IF;
  IF OLD.state = 'PAID' AND NEW.state NOT IN ('PAID', 'PARTIALLY_PAID', 'POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'paid supplier documents have an invalid transition';
  END IF;
  IF OLD.state = 'REVERSED' AND NEW.state <> 'REVERSED' THEN
    RAISE EXCEPTION 'reversed supplier documents are terminal';
  END IF;
  IF OLD.state = 'RETURNED' AND NEW.state <> 'RETURNED' THEN
    RAISE EXCEPTION 'returned supplier documents are terminal';
  END IF;
  RETURN NEW;
END;
$$;
