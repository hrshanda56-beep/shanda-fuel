-- Quotations, invoices and receipts (DEC-045). Standalone: nothing here posts to the customer
-- ledger, cash, profit or any report. Additive only. Local development databases until approved.
--
-- Drafts are edited by writing a new revision: lines are append-only and the document's current
-- revision says which lines are live, so the runtime role never needs DELETE. An issued document
-- keeps its number and its figures; it can only be marked accepted or voided.

CREATE TABLE "app"."sales_doc_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "address" text,
  "phone" text,
  "email" text,
  "tax_label" text NOT NULL DEFAULT 'VAT',
  "tax_number" text,
  "default_tax_rate" numeric(9, 4) NOT NULL DEFAULT 0,
  "bank_details" text,
  "default_terms" text,
  "footer" text,
  "quotation_prefix" text NOT NULL DEFAULT 'QT',
  "invoice_prefix" text NOT NULL DEFAULT 'INV',
  "receipt_prefix" text NOT NULL DEFAULT 'RC',
  "default_valid_days" integer NOT NULL DEFAULT 30,
  "default_due_days" integer NOT NULL DEFAULT 30,
  "version" integer NOT NULL DEFAULT 0,
  "updated_by" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_doc_profiles_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "sales_doc_profiles_entity_uidx" UNIQUE ("tenant_id", "legal_entity_id"),
  CONSTRAINT "sales_doc_profiles_name_ck" CHECK (btrim("display_name") <> '' AND char_length("display_name") <= 200),
  CONSTRAINT "sales_doc_profiles_text_ck" CHECK (
    coalesce(char_length("address"), 0) <= 500 AND coalesce(char_length("phone"), 0) <= 60
    AND coalesce(char_length("email"), 0) <= 200 AND char_length("tax_label") BETWEEN 1 AND 30
    AND coalesce(char_length("tax_number"), 0) <= 60 AND coalesce(char_length("bank_details"), 0) <= 1000
    AND coalesce(char_length("default_terms"), 0) <= 2000 AND coalesce(char_length("footer"), 0) <= 500
  ),
  CONSTRAINT "sales_doc_profiles_prefix_ck" CHECK (
    "quotation_prefix" ~ '^[A-Za-z0-9-]{1,10}$' AND "invoice_prefix" ~ '^[A-Za-z0-9-]{1,10}$'
    AND "receipt_prefix" ~ '^[A-Za-z0-9-]{1,10}$'
  ),
  CONSTRAINT "sales_doc_profiles_rate_ck" CHECK ("default_tax_rate" >= 0 AND "default_tax_rate" <= 100),
  CONSTRAINT "sales_doc_profiles_days_ck" CHECK ("default_valid_days" BETWEEN 0 AND 365 AND "default_due_days" BETWEEN 0 AND 365)
);
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD CONSTRAINT "sales_doc_profiles_entity_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id")
  REFERENCES "app"."legal_entities"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_profiles" ADD CONSTRAINT "sales_doc_profiles_updated_by_fk"
  FOREIGN KEY ("tenant_id", "updated_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "app"."sales_doc_counters" (
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "doc_type" text NOT NULL,
  "doc_year" integer NOT NULL,
  "last_number" integer NOT NULL DEFAULT 0,
  CONSTRAINT "sales_doc_counters_pk" PRIMARY KEY ("tenant_id", "legal_entity_id", "doc_type", "doc_year"),
  CONSTRAINT "sales_doc_counters_type_ck" CHECK ("doc_type" IN ('QUOTATION', 'INVOICE', 'RECEIPT')),
  CONSTRAINT "sales_doc_counters_year_ck" CHECK ("doc_year" BETWEEN 2000 AND 2200),
  CONSTRAINT "sales_doc_counters_last_ck" CHECK ("last_number" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."sales_doc_counters" ADD CONSTRAINT "sales_doc_counters_entity_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id")
  REFERENCES "app"."legal_entities"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "app"."sales_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "doc_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "revision" integer NOT NULL DEFAULT 1,
  "doc_year" integer,
  "doc_seq" integer,
  "doc_number" text,
  "customer_id" uuid,
  "recipient_name" text NOT NULL,
  "recipient_address" text,
  "recipient_tax_number" text,
  "recipient_email" text,
  "issue_date" date NOT NULL,
  "valid_until" date,
  "due_date" date,
  "currency" text NOT NULL DEFAULT 'USD',
  "tax_label" text NOT NULL DEFAULT 'VAT',
  "subtotal" numeric(20, 4) NOT NULL DEFAULT 0,
  "discount_total" numeric(20, 4) NOT NULL DEFAULT 0,
  "tax_total" numeric(20, 4) NOT NULL DEFAULT 0,
  "total" numeric(20, 4) NOT NULL DEFAULT 0,
  "notes" text,
  "terms" text,
  "letterhead" jsonb,
  "source_document_id" uuid,
  "payment_method" text,
  "payment_reference" text,
  "paid_on" date,
  "issued_at" timestamp with time zone,
  "issued_by" uuid,
  "accepted_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  "void_reason" text,
  "version" integer NOT NULL DEFAULT 0,
  "created_by" uuid NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_documents_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "sales_documents_type_ck" CHECK ("doc_type" IN ('QUOTATION', 'INVOICE', 'RECEIPT')),
  CONSTRAINT "sales_documents_status_ck" CHECK ("status" IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'VOIDED')),
  CONSTRAINT "sales_documents_accepted_ck" CHECK ("status" <> 'ACCEPTED' OR "doc_type" = 'QUOTATION'),
  CONSTRAINT "sales_documents_numbered_ck" CHECK (
    "status" = 'DRAFT' OR ("doc_number" IS NOT NULL AND "doc_seq" IS NOT NULL AND "doc_year" IS NOT NULL AND "issued_at" IS NOT NULL AND "issued_by" IS NOT NULL AND "letterhead" IS NOT NULL)
  ),
  CONSTRAINT "sales_documents_void_ck" CHECK (
    ("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND btrim(coalesce("void_reason", '')) <> '')
  ),
  CONSTRAINT "sales_documents_receipt_ck" CHECK (
    "doc_type" <> 'RECEIPT' OR ("source_document_id" IS NOT NULL AND "payment_method" IS NOT NULL AND "paid_on" IS NOT NULL AND "total" > 0)
  ),
  CONSTRAINT "sales_documents_money_ck" CHECK (
    "subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "total" >= 0
  ),
  CONSTRAINT "sales_documents_currency_ck" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "sales_documents_text_ck" CHECK (
    btrim("recipient_name") <> '' AND char_length("recipient_name") <= 200
    AND coalesce(char_length("recipient_address"), 0) <= 500 AND coalesce(char_length("recipient_tax_number"), 0) <= 60
    AND coalesce(char_length("recipient_email"), 0) <= 200 AND char_length("tax_label") BETWEEN 1 AND 30
    AND coalesce(char_length("notes"), 0) <= 2000 AND coalesce(char_length("terms"), 0) <= 2000
    AND coalesce(char_length("payment_method"), 0) <= 60 AND coalesce(char_length("payment_reference"), 0) <= 120
    AND coalesce(char_length("void_reason"), 0) <= 500
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_documents_number_uidx"
  ON "app"."sales_documents" ("tenant_id", "legal_entity_id", "doc_type", "doc_number")
  WHERE "doc_number" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "sales_documents_list_idx"
  ON "app"."sales_documents" ("tenant_id", "legal_entity_id", "doc_type", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "sales_documents_source_idx"
  ON "app"."sales_documents" ("tenant_id", "source_document_id") WHERE "source_document_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."sales_documents" ADD CONSTRAINT "sales_documents_entity_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id")
  REFERENCES "app"."legal_entities"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."sales_documents" ADD CONSTRAINT "sales_documents_customer_fk"
  FOREIGN KEY ("tenant_id", "customer_id")
  REFERENCES "app"."customers"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."sales_documents" ADD CONSTRAINT "sales_documents_source_fk"
  FOREIGN KEY ("tenant_id", "source_document_id")
  REFERENCES "app"."sales_documents"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."sales_documents" ADD CONSTRAINT "sales_documents_created_by_fk"
  FOREIGN KEY ("tenant_id", "created_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."sales_documents" ADD CONSTRAINT "sales_documents_updated_by_fk"
  FOREIGN KEY ("tenant_id", "updated_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "app"."sales_document_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "line_no" integer NOT NULL,
  "product_id" uuid,
  "description" text NOT NULL,
  "quantity" numeric(18, 3) NOT NULL,
  "unit_label" text,
  "unit_price" numeric(20, 6) NOT NULL,
  "discount_amount" numeric(20, 4) NOT NULL DEFAULT 0,
  "tax_rate" numeric(9, 4) NOT NULL DEFAULT 0,
  "net_amount" numeric(20, 4) NOT NULL,
  "tax_amount" numeric(20, 4) NOT NULL,
  "line_total" numeric(20, 4) NOT NULL,
  CONSTRAINT "sales_document_lines_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "sales_document_lines_position_uidx" UNIQUE ("tenant_id", "document_id", "revision", "line_no"),
  CONSTRAINT "sales_document_lines_text_ck" CHECK (
    btrim("description") <> '' AND char_length("description") <= 300 AND coalesce(char_length("unit_label"), 0) <= 20
  ),
  CONSTRAINT "sales_document_lines_amounts_ck" CHECK (
    "quantity" > 0 AND "unit_price" >= 0 AND "discount_amount" >= 0 AND "net_amount" >= 0 AND "tax_amount" >= 0
    AND "line_total" = "net_amount" + "tax_amount" AND "tax_rate" >= 0 AND "tax_rate" <= 100
  ),
  CONSTRAINT "sales_document_lines_number_ck" CHECK ("revision" >= 1 AND "line_no" >= 1)
);
--> statement-breakpoint
ALTER TABLE "app"."sales_document_lines" ADD CONSTRAINT "sales_document_lines_document_fk"
  FOREIGN KEY ("tenant_id", "document_id")
  REFERENCES "app"."sales_documents"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."sales_document_lines" ADD CONSTRAINT "sales_document_lines_product_fk"
  FOREIGN KEY ("tenant_id", "product_id")
  REFERENCES "app"."products"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sales_documents_state_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'a voided document cannot change';
  END IF;
  -- Issued or accepted: figures, number, recipient and letterhead are fixed. Only the status
  -- moves (accepted, voided) together with its own provenance.
  IF NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
    OR NEW.doc_number IS DISTINCT FROM OLD.doc_number OR NEW.doc_seq IS DISTINCT FROM OLD.doc_seq
    OR NEW.doc_year IS DISTINCT FROM OLD.doc_year OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
    OR NEW.recipient_address IS DISTINCT FROM OLD.recipient_address
    OR NEW.recipient_tax_number IS DISTINCT FROM OLD.recipient_tax_number
    OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.tax_label IS DISTINCT FROM OLD.tax_label
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
    OR NEW.tax_total IS DISTINCT FROM OLD.tax_total OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.terms IS DISTINCT FROM OLD.terms
    OR NEW.letterhead IS DISTINCT FROM OLD.letterhead OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
    OR NEW.paid_on IS DISTINCT FROM OLD.paid_on OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'an issued document cannot be edited; void it and issue a new one';
  END IF;
  IF NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'an issued document cannot go back to draft';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_documents_state_guard
BEFORE UPDATE ON app.sales_documents
FOR EACH ROW EXECUTE FUNCTION app.sales_documents_state_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.sales_document_lines_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'sales document lines are immutable; save a new revision instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_document_lines_append_only
BEFORE UPDATE OR DELETE ON app.sales_document_lines
FOR EACH ROW EXECUTE FUNCTION app.sales_document_lines_append_only();
--> statement-breakpoint
ALTER TABLE app.sales_doc_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_doc_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_doc_profiles_tenant_context ON app.sales_doc_profiles
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
ALTER TABLE app.sales_doc_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_doc_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_doc_counters_tenant_context ON app.sales_doc_counters
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
ALTER TABLE app.sales_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_documents_tenant_context ON app.sales_documents
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
ALTER TABLE app.sales_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_document_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_document_lines_tenant_context ON app.sales_document_lines
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description)
VALUES
  ('sales_document.view', 'See quotations, invoices and receipts'),
  ('sales_document.create', 'Prepare quotation, invoice and receipt drafts'),
  ('sales_document.issue', 'Issue a quotation, invoice or receipt and give it a number'),
  ('sales_document.void', 'Void an issued quotation, invoice or receipt'),
  ('sales_document.profile.manage', 'Edit the company letterhead and numbering for documents')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'sales_document.view'), ('OWNER', 'sales_document.create'), ('OWNER', 'sales_document.issue'),
  ('OWNER', 'sales_document.void'), ('OWNER', 'sales_document.profile.manage'),
  ('ADMINISTRATOR', 'sales_document.view'), ('ADMINISTRATOR', 'sales_document.create'),
  ('ADMINISTRATOR', 'sales_document.issue'), ('ADMINISTRATOR', 'sales_document.void'),
  ('ADMINISTRATOR', 'sales_document.profile.manage'),
  ('FINANCE', 'sales_document.view'), ('FINANCE', 'sales_document.create'), ('FINANCE', 'sales_document.issue'),
  -- The auditor reads every screen; the code derives this from the ".view" name, so the database matches.
  ('AUDITOR', 'sales_document.view')
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.sales_doc_profiles OWNER TO migration_owner;
    ALTER TABLE app.sales_doc_counters OWNER TO migration_owner;
    ALTER TABLE app.sales_documents OWNER TO migration_owner;
    ALTER TABLE app.sales_document_lines OWNER TO migration_owner;
    ALTER FUNCTION app.sales_documents_state_guard() OWNER TO migration_owner;
    ALTER FUNCTION app.sales_document_lines_append_only() OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.sales_doc_profiles TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.sales_doc_profiles FROM app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.sales_doc_counters TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.sales_doc_counters FROM app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.sales_documents TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.sales_documents FROM app_runtime;
    GRANT SELECT, INSERT ON app.sales_document_lines TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.sales_document_lines FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.sales_doc_profiles, app.sales_doc_counters, app.sales_documents, app.sales_document_lines TO diagnostics_readonly;
  END IF;
END
$$;
