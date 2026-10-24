-- ADR-018 supplier side: mandatory supplier on a delivery, supplier invoice lines,
-- delivery-to-invoice coverage control, and the customizable purchasing policy.
-- Hand-authored (additive and backward compatible). Existing deliveries keep a NULL
-- supplier ("supplier unassigned"); existing header-only invoices stay valid.

-- 1. Supplier on the delivery (composite tenant-safe FK; NULL only for legacy rows).
ALTER TABLE "app"."fuel_deliveries" ADD COLUMN "supplier_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fuel_deliveries_supplier_idx" ON "app"."fuel_deliveries" USING btree ("tenant_id","supplier_id") WHERE "supplier_id" IS NOT NULL;
--> statement-breakpoint

-- 2. Invoice totals, VAT facts and variance outcome on the supplier document header.
-- NULL net/vat/mode marks a legacy header-only document.
ALTER TABLE "app"."supplier_documents"
  ADD COLUMN "net_amount" numeric(20, 4),
  ADD COLUMN "vat_amount" numeric(20, 4),
  ADD COLUMN "vat_mode" text,
  ADD COLUMN "variance_status" text DEFAULT 'NOT_EVALUATED' NOT NULL,
  ADD COLUMN "variance_snapshot" jsonb,
  ADD COLUMN "variance_approval_reason" text,
  ADD COLUMN "variance_approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_vat_mode_ck" CHECK ("vat_mode" IS NULL OR "vat_mode" IN ('NONE','EXCLUSIVE','INCLUSIVE'));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_totals_ck" CHECK (("net_amount" IS NULL AND "vat_amount" IS NULL AND "vat_mode" IS NULL) OR ("net_amount" IS NOT NULL AND "vat_amount" IS NOT NULL AND "vat_mode" IS NOT NULL AND "net_amount" >= 0 AND "vat_amount" >= 0 AND "net_amount" + "vat_amount" = "amount"));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_variance_status_ck" CHECK ("variance_status" IN ('NOT_EVALUATED','WITHIN_TOLERANCE','FLAGGED','APPROVED'));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_variance_approval_ck" CHECK ("variance_status" <> 'APPROVED' OR ("variance_approved_by" IS NOT NULL AND btrim(coalesce("variance_approval_reason", '')) <> ''));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_variance_approved_by_fk" FOREIGN KEY ("tenant_id","variance_approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- 3. Coverage facts on the delivery references.
ALTER TABLE "app"."supplier_document_delivery_refs"
  ADD COLUMN "document_type" text,
  ADD COLUMN "invoiced_quantity_litres" numeric(18, 3),
  ADD COLUMN "invoiced_amount" numeric(20, 4),
  ADD COLUMN "active" boolean DEFAULT false NOT NULL,
  ADD COLUMN "released_at" timestamp with time zone,
  ADD COLUMN "needs_finance_review" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Backfill (owner bypass is needed because the tables are FORCE RLS). Where two posted
-- invoices already cover one delivery the earliest keeps coverage and the rest are
-- flagged for Finance review rather than rewritten.
ALTER TABLE "app"."supplier_document_delivery_refs" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "app"."supplier_document_delivery_refs" r
SET "document_type" = d."document_type"
FROM "app"."supplier_documents" d
WHERE d."tenant_id" = r."tenant_id" AND d."id" = r."supplier_document_id";
--> statement-breakpoint
WITH ranked AS (
  SELECT r."id",
         row_number() OVER (
           PARTITION BY r."tenant_id", r."delivery_id", coalesce(r."allocation_id", '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY d."posted_at", r."id"
         ) AS position,
         d."document_type"
  FROM "app"."supplier_document_delivery_refs" r
  JOIN "app"."supplier_documents" d ON d."tenant_id" = r."tenant_id" AND d."id" = r."supplier_document_id"
  WHERE d."state" IN ('POSTED','PARTIALLY_PAID','PAID')
)
UPDATE "app"."supplier_document_delivery_refs" r
SET "active" = (ranked.position = 1 OR ranked."document_type" = 'CREDIT_NOTE'),
    "needs_finance_review" = (ranked.position > 1 AND ranked."document_type" = 'INVOICE')
FROM ranked
WHERE ranked."id" = r."id";
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ALTER COLUMN "document_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_document_type_ck" CHECK ("document_type" IN ('INVOICE','CREDIT_NOTE'));
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_quantity_ck" CHECK ("invoiced_quantity_litres" IS NULL OR "invoiced_quantity_litres" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_amount_ck" CHECK ("invoiced_amount" IS NULL OR "invoiced_amount" >= 0);
--> statement-breakpoint
-- I3: one supplier delivery allocation is covered by at most one posted, non-reversed INVOICE.
-- A NULL allocation means the whole delivery. Overlap between a whole-delivery reference and
-- an allocation reference is rejected by the lock-and-check in PostSupplierDocument.
-- Credit notes are exempt because a credit note is a reduction, not a new payable.
CREATE UNIQUE INDEX "supplier_document_delivery_refs_active_invoice_uidx" ON "app"."supplier_document_delivery_refs" USING btree ("tenant_id","delivery_id",(coalesce("allocation_id", '00000000-0000-0000-0000-000000000000'::uuid))) WHERE "active" AND "document_type" = 'INVOICE';
--> statement-breakpoint

-- 4. Invoice lines.
CREATE TABLE "app"."supplier_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"supplier_document_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(20, 8) NOT NULL,
	"net_amount" numeric(20, 4) NOT NULL,
	"vat_rate" numeric(9, 4),
	"vat_amount" numeric(20, 4) DEFAULT 0 NOT NULL,
	"gross_amount" numeric(20, 4) NOT NULL,
	"delivery_ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_document_lines_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_document_lines_document_line_uidx" UNIQUE("tenant_id","supplier_document_id","line_no"),
	CONSTRAINT "supplier_document_lines_line_no_ck" CHECK ("line_no" > 0),
	CONSTRAINT "supplier_document_lines_description_ck" CHECK (btrim("description") <> ''),
	CONSTRAINT "supplier_document_lines_quantity_ck" CHECK ("quantity" > 0),
	CONSTRAINT "supplier_document_lines_unit_price_ck" CHECK ("unit_price" >= 0),
	CONSTRAINT "supplier_document_lines_amounts_ck" CHECK ("net_amount" >= 0 AND "vat_amount" >= 0 AND "gross_amount" = "net_amount" + "vat_amount"),
	CONSTRAINT "supplier_document_lines_vat_rate_ck" CHECK ("vat_rate" IS NULL OR ("vat_rate" >= 0 AND "vat_rate" <= 100))
);
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD CONSTRAINT "supplier_document_lines_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD CONSTRAINT "supplier_document_lines_document_fk" FOREIGN KEY ("tenant_id","supplier_document_id") REFERENCES "app"."supplier_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD CONSTRAINT "supplier_document_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."supplier_document_lines" ADD CONSTRAINT "supplier_document_lines_delivery_ref_fk" FOREIGN KEY ("tenant_id","delivery_ref_id") REFERENCES "app"."supplier_document_delivery_refs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "supplier_document_lines_document_idx" ON "app"."supplier_document_lines" USING btree ("tenant_id","supplier_document_id");
--> statement-breakpoint

-- 5. Customizable purchasing policy (per tenant, optional per-supplier overrides).
CREATE TABLE "app"."purchasing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"quantity_tolerance_litres" numeric(18, 3),
	"quantity_tolerance_percent" numeric(9, 4),
	"price_tolerance_percent" numeric(9, 4),
	"amount_tolerance" numeric(20, 4),
	"over_receipt_tolerance_litres" numeric(18, 3),
	"over_receipt_tolerance_percent" numeric(9, 4),
	"tolerance_action" text,
	"vat_mode" text,
	"default_vat_rate" numeric(9, 4),
	"product_vat_rates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"require_invoice_lines" boolean,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchasing_policies_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchasing_policies_tolerances_ck" CHECK (
		("quantity_tolerance_litres" IS NULL OR "quantity_tolerance_litres" >= 0)
		AND ("quantity_tolerance_percent" IS NULL OR ("quantity_tolerance_percent" >= 0 AND "quantity_tolerance_percent" <= 100))
		AND ("price_tolerance_percent" IS NULL OR ("price_tolerance_percent" >= 0 AND "price_tolerance_percent" <= 100))
		AND ("amount_tolerance" IS NULL OR "amount_tolerance" >= 0)
		AND ("over_receipt_tolerance_litres" IS NULL OR "over_receipt_tolerance_litres" >= 0)
		AND ("over_receipt_tolerance_percent" IS NULL OR ("over_receipt_tolerance_percent" >= 0 AND "over_receipt_tolerance_percent" <= 100))),
	CONSTRAINT "purchasing_policies_action_ck" CHECK ("tolerance_action" IS NULL OR "tolerance_action" IN ('FLAG','REQUIRE_APPROVAL')),
	CONSTRAINT "purchasing_policies_vat_mode_ck" CHECK ("vat_mode" IS NULL OR "vat_mode" IN ('NONE','EXCLUSIVE','INCLUSIVE')),
	CONSTRAINT "purchasing_policies_vat_rate_ck" CHECK ("default_vat_rate" IS NULL OR ("default_vat_rate" >= 0 AND "default_vat_rate" <= 100)),
	CONSTRAINT "purchasing_policies_tenant_level_ck" CHECK ("supplier_id" IS NOT NULL OR ("tolerance_action" IS NOT NULL AND "vat_mode" IS NOT NULL AND "require_invoice_lines" IS NOT NULL)),
	CONSTRAINT "purchasing_policies_product_rates_tenant_only_ck" CHECK ("supplier_id" IS NULL OR "product_vat_rates" = '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "app"."purchasing_policies" ADD CONSTRAINT "purchasing_policies_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchasing_policies" ADD CONSTRAINT "purchasing_policies_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "purchasing_policies_tenant_uidx" ON "app"."purchasing_policies" USING btree ("tenant_id") WHERE "supplier_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "purchasing_policies_supplier_uidx" ON "app"."purchasing_policies" USING btree ("tenant_id","supplier_id") WHERE "supplier_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "app"."purchasing_policy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchasing_policy_revisions_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchasing_policy_revisions_version_uidx" UNIQUE("tenant_id","policy_id","version")
);
--> statement-breakpoint
ALTER TABLE "app"."purchasing_policy_revisions" ADD CONSTRAINT "purchasing_policy_revisions_policy_fk" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "app"."purchasing_policies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchasing_policy_revisions" ADD CONSTRAINT "purchasing_policy_revisions_changed_by_fk" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- 6. Append-only record of delivery supplier corrections.
CREATE TABLE "app"."delivery_supplier_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"previous_supplier_id" uuid,
	"supplier_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_supplier_corrections_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "delivery_supplier_corrections_reason_ck" CHECK (btrim("reason") <> ''),
	CONSTRAINT "delivery_supplier_corrections_change_ck" CHECK ("previous_supplier_id" IS DISTINCT FROM "supplier_id")
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_supplier_corrections" ADD CONSTRAINT "delivery_supplier_corrections_delivery_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id") REFERENCES "app"."fuel_deliveries"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."delivery_supplier_corrections" ADD CONSTRAINT "delivery_supplier_corrections_previous_fk" FOREIGN KEY ("tenant_id","previous_supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."delivery_supplier_corrections" ADD CONSTRAINT "delivery_supplier_corrections_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."delivery_supplier_corrections" ADD CONSTRAINT "delivery_supplier_corrections_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "delivery_supplier_corrections_delivery_idx" ON "app"."delivery_supplier_corrections" USING btree ("tenant_id","station_id","delivery_id");
--> statement-breakpoint

-- 7. Permissions.
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('supplier.delivery.link', 'Link a physical delivery to a supplier invoice and correct the supplier recorded on a delivery'),
  ('purchasing.policy.manage', 'Set purchasing tolerances, VAT configuration and invoice-line rules')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'supplier.delivery.link'), ('OWNER', 'purchasing.policy.manage'),
  ('ADMINISTRATOR', 'supplier.delivery.link'), ('ADMINISTRATOR', 'purchasing.policy.manage'),
  ('FINANCE', 'supplier.delivery.link')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 8. Guards.

-- A delivery is immutable once confirmed or cancelled, except for the named supplier
-- correction (CorrectDeliverySupplier): only supplier_id may change, the command must
-- have said so, and no posted supplier document may reference the delivery.
CREATE OR REPLACE FUNCTION app.a4_reject_posted_delivery_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('CONFIRMED', 'CANCELLED') THEN
    IF OLD.status = 'CONFIRMED' AND NEW.status = 'CONFIRMED'
       AND NEW.supplier_id IS NOT NULL
       AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       AND current_setting('app.delivery_supplier_correction', true) = 'on'
       AND (to_jsonb(NEW) - 'supplier_id' - 'updated_at') = (to_jsonb(OLD) - 'supplier_id' - 'updated_at') THEN
      IF EXISTS (
        SELECT 1
        FROM app.supplier_document_delivery_refs r
        JOIN app.supplier_documents d ON d.tenant_id = r.tenant_id AND d.id = r.supplier_document_id
        WHERE r.tenant_id = OLD.tenant_id AND r.delivery_id = OLD.id
          AND d.state IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
      ) THEN
        RAISE EXCEPTION 'the supplier of a delivery covered by a posted supplier document cannot be corrected';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'confirmed or cancelled deliveries are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Header totals are facts once the document leaves submission.
CREATE OR REPLACE FUNCTION app.a7_supplier_document_totals_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state NOT IN ('DRAFT', 'SUBMITTED') AND (
    NEW.net_amount IS DISTINCT FROM OLD.net_amount OR
    NEW.vat_amount IS DISTINCT FROM OLD.vat_amount OR
    NEW.vat_mode IS DISTINCT FROM OLD.vat_mode
  ) THEN
    RAISE EXCEPTION 'finalized supplier document totals are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_documents_totals_guard
BEFORE UPDATE ON app.supplier_documents
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_document_totals_guard();
--> statement-breakpoint

-- Coverage facts: a reference is written inactive, may only be activated by a posted
-- document of the delivery's own supplier, and only active/released_at ever change.
CREATE OR REPLACE FUNCTION app.a7_supplier_delivery_ref_coverage_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document_row app.supplier_documents%ROWTYPE;
  delivery_supplier uuid;
BEGIN
  SELECT * INTO document_row FROM app.supplier_documents
  WHERE tenant_id = NEW.tenant_id AND id = NEW.supplier_document_id;
  IF document_row.id IS NULL OR document_row.document_type IS DISTINCT FROM NEW.document_type THEN
    RAISE EXCEPTION 'delivery reference document type must match its supplier document';
  END IF;
  SELECT supplier_id INTO delivery_supplier FROM app.fuel_deliveries
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.delivery_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.active THEN
      RAISE EXCEPTION 'delivery references are created inactive and activated when the document is posted';
    END IF;
    IF delivery_supplier IS DISTINCT FROM document_row.supplier_id THEN
      RAISE EXCEPTION 'the delivery must belong to the supplier of the document';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'active' - 'released_at') IS DISTINCT FROM (to_jsonb(OLD) - 'active' - 'released_at') THEN
    RAISE EXCEPTION 'delivery reference facts are immutable';
  END IF;
  IF NEW.active AND NOT OLD.active THEN
    IF document_row.state NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
       OR delivery_supplier IS DISTINCT FROM document_row.supplier_id THEN
      RAISE EXCEPTION 'a delivery reference can only cover a delivery of the posted document supplier';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_document_delivery_refs_coverage_guard
BEFORE INSERT OR UPDATE ON app.supplier_document_delivery_refs
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_delivery_ref_coverage_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a7_supplier_document_line_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document_row app.supplier_documents%ROWTYPE;
  ref_row app.supplier_document_delivery_refs%ROWTYPE;
  delivery_product uuid;
BEGIN
  SELECT * INTO document_row FROM app.supplier_documents
  WHERE tenant_id = NEW.tenant_id AND id = NEW.supplier_document_id;
  IF document_row.id IS NULL OR document_row.legal_entity_id <> NEW.legal_entity_id THEN
    RAISE EXCEPTION 'supplier document line must use the document legal entity';
  END IF;
  IF document_row.state NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'lines can only be added while the supplier document is being submitted';
  END IF;
  IF NEW.delivery_ref_id IS NOT NULL THEN
    SELECT * INTO ref_row FROM app.supplier_document_delivery_refs
    WHERE tenant_id = NEW.tenant_id AND id = NEW.delivery_ref_id;
    IF ref_row.id IS NULL OR ref_row.supplier_document_id <> NEW.supplier_document_id THEN
      RAISE EXCEPTION 'a line can only reference a delivery link of the same document';
    END IF;
    IF NEW.product_id IS NOT NULL THEN
      SELECT product_id INTO delivery_product FROM app.fuel_deliveries
      WHERE tenant_id = NEW.tenant_id AND station_id = ref_row.station_id AND id = ref_row.delivery_id;
      IF delivery_product IS DISTINCT FROM NEW.product_id THEN
        RAISE EXCEPTION 'the line product must match the product of the delivery it is linked to';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_document_lines_guard
BEFORE INSERT ON app.supplier_document_lines
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_document_line_guard();
--> statement-breakpoint

-- 9. RLS and grants for the new tables.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'supplier_document_lines', 'purchasing_policies',
    'purchasing_policy_revisions', 'delivery_supplier_corrections'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())',
      table_name || '_tenant_context', table_name
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.purchasing_policies TO app_runtime;
    GRANT SELECT, INSERT ON
      app.supplier_document_lines, app.purchasing_policy_revisions, app.delivery_supplier_corrections
    TO app_runtime;
    -- Delivery references stay facts; only the coverage flag may change.
    GRANT UPDATE (active, released_at) ON app.supplier_document_delivery_refs TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON
      app.supplier_document_lines, app.purchasing_policies,
      app.purchasing_policy_revisions, app.delivery_supplier_corrections
    TO diagnostics_readonly;
  END IF;
END
$$;
--> statement-breakpoint

REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON
  app.supplier_document_lines, app.purchasing_policies,
  app.purchasing_policy_revisions, app.delivery_supplier_corrections
FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE ON
  app.supplier_document_lines, app.purchasing_policy_revisions, app.delivery_supplier_corrections
FROM app_runtime;
