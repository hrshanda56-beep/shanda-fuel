-- A delivery can now be covered by two separate supplier bills: the fuel invoice and the
-- transporter's own bill. The delivery link records which kind it is. Existing links are fuel.
-- The "one active invoice per delivery" rule now applies per kind, so a transport bill never
-- blocks, or is blocked by, the fuel invoice. RLS, grants and triggers are unchanged.
ALTER TABLE "app"."supplier_document_delivery_refs"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'FUEL';
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs"
  ADD CONSTRAINT "supplier_document_delivery_refs_kind_ck" CHECK ("kind" IN ('FUEL','TRANSPORT'));
--> statement-breakpoint
DROP INDEX "app"."supplier_document_delivery_refs_active_invoice_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_document_delivery_refs_active_invoice_uidx" ON "app"."supplier_document_delivery_refs" USING btree ("tenant_id","delivery_id","kind",(coalesce("allocation_id", '00000000-0000-0000-0000-000000000000'::uuid))) WHERE "active" AND "document_type" = 'INVOICE';
--> statement-breakpoint
-- A FUEL link must be to a delivery from the document's supplier (unchanged). A TRANSPORT link must
-- be to a delivery that the document's supplier carried. Nothing else in the guard changes.
CREATE OR REPLACE FUNCTION app.a7_supplier_delivery_ref_coverage_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_row app.supplier_documents%ROWTYPE;
  delivery_supplier uuid;
  delivery_transporter uuid;
  expected_supplier uuid;
BEGIN
  SELECT * INTO document_row FROM app.supplier_documents
  WHERE tenant_id = NEW.tenant_id AND id = NEW.supplier_document_id;
  IF document_row.id IS NULL OR document_row.document_type IS DISTINCT FROM NEW.document_type THEN
    RAISE EXCEPTION 'delivery reference document type must match its supplier document';
  END IF;
  SELECT supplier_id, transporter_supplier_id INTO delivery_supplier, delivery_transporter
  FROM app.fuel_deliveries
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.delivery_id;
  expected_supplier := CASE WHEN NEW.kind = 'TRANSPORT' THEN delivery_transporter ELSE delivery_supplier END;
  IF TG_OP = 'INSERT' THEN
    IF NEW.active THEN
      RAISE EXCEPTION 'delivery references are created inactive and activated when the document is posted';
    END IF;
    IF expected_supplier IS DISTINCT FROM document_row.supplier_id THEN
      RAISE EXCEPTION 'the delivery must belong to the supplier of the document';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'active' - 'released_at') IS DISTINCT FROM (to_jsonb(OLD) - 'active' - 'released_at') THEN
    RAISE EXCEPTION 'delivery reference facts are immutable';
  END IF;
  IF NEW.active AND NOT OLD.active THEN
    IF document_row.state NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
       OR expected_supplier IS DISTINCT FROM document_row.supplier_id THEN
      RAISE EXCEPTION 'a delivery reference can only cover a delivery of the posted document supplier';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
