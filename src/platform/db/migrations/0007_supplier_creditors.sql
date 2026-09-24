CREATE TABLE "app"."supplier_account_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"effective_date" text NOT NULL,
	"reversal_of_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_account_movements_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_account_movements_source_uidx" UNIQUE("tenant_id","source_type","source_id","movement_type"),
	CONSTRAINT "supplier_account_movements_type_ck" CHECK ("app"."supplier_account_movements"."movement_type" in ('INVOICE','CREDIT_NOTE','PAYMENT','PAYMENT_REVERSAL','ADJUSTMENT')),
	CONSTRAINT "supplier_account_movements_amount_positive_ck" CHECK ("app"."supplier_account_movements"."amount" > 0),
	CONSTRAINT "supplier_account_movements_currency_ck" CHECK ("app"."supplier_account_movements"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "app"."supplier_document_delivery_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"supplier_document_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"allocation_id" uuid,
	"linked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_document_delivery_refs_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_document_delivery_refs_document_source_uidx" UNIQUE("tenant_id","supplier_document_id","delivery_id","allocation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."supplier_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"reference_number" text NOT NULL,
	"document_date" text NOT NULL,
	"due_date" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_documents_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_documents_tenant_supplier_reference_uidx" UNIQUE("tenant_id","supplier_id","reference_number"),
	CONSTRAINT "supplier_documents_type_ck" CHECK ("app"."supplier_documents"."document_type" in ('INVOICE','CREDIT_NOTE')),
	CONSTRAINT "supplier_documents_reference_nonempty_ck" CHECK (btrim("app"."supplier_documents"."reference_number") <> ''),
	CONSTRAINT "supplier_documents_currency_ck" CHECK ("app"."supplier_documents"."currency" = 'USD'),
	CONSTRAINT "supplier_documents_amount_positive_ck" CHECK ("app"."supplier_documents"."amount" > 0),
	CONSTRAINT "supplier_documents_state_ck" CHECK ("app"."supplier_documents"."state" in ('DRAFT','SUBMITTED','POSTED','PARTIALLY_PAID','PAID','REVERSED')),
	CONSTRAINT "supplier_documents_due_date_order_ck" CHECK ("app"."supplier_documents"."due_date" is null or "app"."supplier_documents"."due_date" >= "app"."supplier_documents"."document_date"),
	CONSTRAINT "supplier_documents_post_provenance_ck" CHECK ("app"."supplier_documents"."posted_at" is null or "app"."supplier_documents"."posted_by" is not null),
	CONSTRAINT "supplier_documents_reversal_provenance_ck" CHECK ("app"."supplier_documents"."state" <> 'REVERSED' or ("app"."supplier_documents"."reversed_by" is not null and "app"."supplier_documents"."reversed_at" is not null and btrim(coalesce("app"."supplier_documents"."reversal_reason", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "app"."supplier_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"state" text DEFAULT 'POSTED' NOT NULL,
	"reversal_of_id" uuid,
	"allocated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payment_allocations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_payment_allocations_amount_positive_ck" CHECK ("app"."supplier_payment_allocations"."amount" > 0),
	CONSTRAINT "supplier_payment_allocations_currency_ck" CHECK ("app"."supplier_payment_allocations"."currency" = 'USD'),
	CONSTRAINT "supplier_payment_allocations_state_ck" CHECK ("app"."supplier_payment_allocations"."state" in ('POSTED','REVERSED')),
	CONSTRAINT "supplier_payment_allocations_reversal_ck" CHECK ("app"."supplier_payment_allocations"."state" <> 'REVERSED' or "app"."supplier_payment_allocations"."reversal_of_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"payment_date" text NOT NULL,
	"payment_reference" text NOT NULL,
	"payment_method" text,
	"external_reference" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "supplier_payments_tenant_supplier_reference_uidx" UNIQUE("tenant_id","supplier_id","payment_reference"),
	CONSTRAINT "supplier_payments_reference_nonempty_ck" CHECK (btrim("app"."supplier_payments"."payment_reference") <> ''),
	CONSTRAINT "supplier_payments_currency_ck" CHECK ("app"."supplier_payments"."currency" = 'USD'),
	CONSTRAINT "supplier_payments_amount_positive_ck" CHECK ("app"."supplier_payments"."amount" > 0),
	CONSTRAINT "supplier_payments_state_ck" CHECK ("app"."supplier_payments"."state" in ('DRAFT','SUBMITTED','POSTED','REVERSED')),
	CONSTRAINT "supplier_payments_post_provenance_ck" CHECK ("app"."supplier_payments"."posted_at" is null or "app"."supplier_payments"."posted_by" is not null),
	CONSTRAINT "supplier_payments_reversal_provenance_ck" CHECK ("app"."supplier_payments"."state" <> 'REVERSED' or ("app"."supplier_payments"."reversed_by" is not null and "app"."supplier_payments"."reversed_at" is not null and btrim(coalesce("app"."supplier_payments"."reversal_reason", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "app"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"registration_reference" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "suppliers_tenant_code_uidx" UNIQUE("tenant_id","code"),
	CONSTRAINT "suppliers_code_nonempty_ck" CHECK (btrim("app"."suppliers"."code") <> ''),
	CONSTRAINT "suppliers_legal_name_nonempty_ck" CHECK (btrim("app"."suppliers"."legal_name") <> ''),
	CONSTRAINT "suppliers_status_ck" CHECK ("app"."suppliers"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "app"."supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_reversal_fk" FOREIGN KEY ("tenant_id","reversal_of_id") REFERENCES "app"."supplier_account_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_document_fk" FOREIGN KEY ("tenant_id","supplier_document_id") REFERENCES "app"."supplier_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_delivery_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id") REFERENCES "app"."fuel_deliveries"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_allocation_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id","allocation_id") REFERENCES "app"."fuel_delivery_allocations"("tenant_id","station_id","delivery_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_document_delivery_refs" ADD CONSTRAINT "supplier_document_delivery_refs_linked_by_fk" FOREIGN KEY ("tenant_id","linked_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_documents" ADD CONSTRAINT "supplier_documents_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "app"."supplier_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "app"."supplier_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_reversal_fk" FOREIGN KEY ("tenant_id","reversal_of_id") REFERENCES "app"."supplier_payment_allocations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_allocated_by_fk" FOREIGN KEY ("tenant_id","allocated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD CONSTRAINT "suppliers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD CONSTRAINT "suppliers_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD CONSTRAINT "suppliers_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_account_movements_supplier_posted_idx" ON "app"."supplier_account_movements" USING btree ("tenant_id","supplier_id","posted_at");--> statement-breakpoint
CREATE INDEX "supplier_account_movements_supplier_effective_idx" ON "app"."supplier_account_movements" USING btree ("tenant_id","supplier_id","effective_date");--> statement-breakpoint
CREATE INDEX "supplier_document_delivery_refs_delivery_idx" ON "app"."supplier_document_delivery_refs" USING btree ("tenant_id","station_id","delivery_id");--> statement-breakpoint
CREATE INDEX "supplier_documents_tenant_supplier_state_idx" ON "app"."supplier_documents" USING btree ("tenant_id","supplier_id","state");--> statement-breakpoint
CREATE INDEX "supplier_documents_tenant_due_date_idx" ON "app"."supplier_documents" USING btree ("tenant_id","due_date","state");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocations_payment_idx" ON "app"."supplier_payment_allocations" USING btree ("tenant_id","payment_id","state");--> statement-breakpoint
CREATE INDEX "supplier_payment_allocations_document_idx" ON "app"."supplier_payment_allocations" USING btree ("tenant_id","document_id","state");--> statement-breakpoint
CREATE INDEX "supplier_payments_tenant_supplier_state_idx" ON "app"."supplier_payments" USING btree ("tenant_id","supplier_id","state");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_status_idx" ON "app"."suppliers" USING btree ("tenant_id","status");

-- A7 authorization is registered in the canonical permission catalog and role map.
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('supplier.view', 'View suppliers, creditor documents, payments, and statements'),
  ('supplier.manage', 'Create and maintain supplier master records'),
  ('supplier.document.create', 'Create and submit supplier invoices and credit notes'),
  ('supplier.document.post', 'Post a supplier invoice or credit note'),
  ('supplier.document.reverse', 'Reverse a posted supplier document'),
  ('supplier.payment.create', 'Create and submit a supplier payment'),
  ('supplier.payment.post', 'Post a supplier payment'),
  ('supplier.payment.allocate', 'Allocate a posted supplier payment to documents'),
  ('supplier.payment.reverse', 'Reverse a posted supplier payment and its allocations'),
  ('supplier.creditor.review', 'Review supplier creditor balances and statements')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'supplier.view'),
  ('OWNER', 'supplier.manage'),
  ('OWNER', 'supplier.document.create'),
  ('OWNER', 'supplier.document.post'),
  ('OWNER', 'supplier.document.reverse'),
  ('OWNER', 'supplier.payment.create'),
  ('OWNER', 'supplier.payment.post'),
  ('OWNER', 'supplier.payment.allocate'),
  ('OWNER', 'supplier.payment.reverse'),
  ('OWNER', 'supplier.creditor.review'),
  ('ADMINISTRATOR', 'supplier.view'),
  ('ADMINISTRATOR', 'supplier.manage'),
  ('ADMINISTRATOR', 'supplier.document.create'),
  ('ADMINISTRATOR', 'supplier.document.post'),
  ('ADMINISTRATOR', 'supplier.document.reverse'),
  ('ADMINISTRATOR', 'supplier.payment.create'),
  ('ADMINISTRATOR', 'supplier.payment.post'),
  ('ADMINISTRATOR', 'supplier.payment.allocate'),
  ('ADMINISTRATOR', 'supplier.payment.reverse'),
  ('ADMINISTRATOR', 'supplier.creditor.review'),
  ('FINANCE', 'supplier.view'),
  ('FINANCE', 'supplier.manage'),
  ('FINANCE', 'supplier.document.create'),
  ('FINANCE', 'supplier.document.post'),
  ('FINANCE', 'supplier.document.reverse'),
  ('FINANCE', 'supplier.payment.create'),
  ('FINANCE', 'supplier.payment.post'),
  ('FINANCE', 'supplier.payment.allocate'),
  ('FINANCE', 'supplier.payment.reverse'),
  ('FINANCE', 'supplier.creditor.review')
ON CONFLICT DO NOTHING;

-- PostgreSQL NULLs are distinct in a normal unique constraint.  Keep one
-- document-to-delivery link when no allocation row is supplied.
CREATE UNIQUE INDEX supplier_document_delivery_refs_document_delivery_null_alloc_uidx
  ON app.supplier_document_delivery_refs (tenant_id, supplier_document_id, delivery_id)
  WHERE allocation_id IS NULL;

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
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED', 'DRAFT', 'POSTED') THEN
    RAISE EXCEPTION 'submitted supplier documents have an invalid transition';
  END IF;
  IF OLD.state IN ('POSTED', 'PARTIALLY_PAID') AND NEW.state NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'REVERSED') THEN
    RAISE EXCEPTION 'posted supplier documents have an invalid transition';
  END IF;
  IF OLD.state = 'PAID' AND NEW.state NOT IN ('PAID', 'REVERSED') THEN
    RAISE EXCEPTION 'paid supplier documents may only be reversed';
  END IF;
  IF OLD.state = 'REVERSED' AND NEW.state <> 'REVERSED' THEN
    RAISE EXCEPTION 'reversed supplier documents are terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_documents_state_guard
BEFORE UPDATE ON app.supplier_documents
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_document_state_guard();

CREATE OR REPLACE FUNCTION app.a7_supplier_payment_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state NOT IN ('DRAFT', 'SUBMITTED') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
    NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR
    NEW.payment_date IS DISTINCT FROM OLD.payment_date OR
    NEW.payment_reference IS DISTINCT FROM OLD.payment_reference OR
    NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.amount IS DISTINCT FROM OLD.amount
  ) THEN
    RAISE EXCEPTION 'finalized supplier payment facts are immutable';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'draft supplier payments must be submitted before posting';
  END IF;
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED', 'DRAFT', 'POSTED') THEN
    RAISE EXCEPTION 'submitted supplier payments have an invalid transition';
  END IF;
  IF OLD.state = 'POSTED' AND NEW.state NOT IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted supplier payments may only be reversed';
  END IF;
  IF OLD.state = 'REVERSED' AND NEW.state <> 'REVERSED' THEN
    RAISE EXCEPTION 'reversed supplier payments are terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_payments_state_guard
BEFORE UPDATE ON app.supplier_payments
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_payment_state_guard();

CREATE OR REPLACE FUNCTION app.a7_supplier_delivery_ref_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_legal_entity_id uuid;
  delivery_status text;
BEGIN
  SELECT legal_entity_id INTO document_legal_entity_id
  FROM app.supplier_documents
  WHERE tenant_id = NEW.tenant_id AND id = NEW.supplier_document_id;
  IF document_legal_entity_id IS NULL OR document_legal_entity_id <> NEW.legal_entity_id THEN
    RAISE EXCEPTION 'supplier delivery reference must use the document legal entity';
  END IF;

  SELECT status INTO delivery_status
  FROM app.fuel_deliveries
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.delivery_id;
  IF delivery_status IS DISTINCT FROM 'CONFIRMED' THEN
    RAISE EXCEPTION 'supplier documents may reference only confirmed fuel deliveries';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_document_delivery_refs_guard
BEFORE INSERT OR UPDATE ON app.supplier_document_delivery_refs
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_delivery_ref_guard();

CREATE OR REPLACE FUNCTION app.a7_supplier_payment_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payment_amount numeric;
  payment_state text;
  payment_supplier_id uuid;
  payment_legal_entity_id uuid;
  document_amount numeric;
  document_state text;
  document_type text;
  document_supplier_id uuid;
  document_legal_entity_id uuid;
  allocated_to_payment numeric;
  allocated_to_document numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.state = 'REVERSED' THEN
    IF NEW.reversal_of_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM app.supplier_payment_allocations original
      WHERE original.tenant_id = NEW.tenant_id
        AND original.id = NEW.reversal_of_id
        AND original.state = 'POSTED'
        AND original.payment_id = NEW.payment_id
        AND original.document_id = NEW.document_id
        AND original.amount = NEW.amount
    ) THEN
      RAISE EXCEPTION 'supplier allocation reversal must identify its posted original';
    END IF;
    RETURN NEW;
  END IF;

  SELECT amount, state, supplier_id, legal_entity_id
  INTO payment_amount, payment_state, payment_supplier_id, payment_legal_entity_id
  FROM app.supplier_payments
  WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id
  FOR UPDATE;
  SELECT amount, state, document_type, supplier_id, legal_entity_id
  INTO document_amount, document_state, document_type, document_supplier_id, document_legal_entity_id
  FROM app.supplier_documents
  WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id
  FOR UPDATE;

  IF payment_amount IS NULL OR document_amount IS NULL
     OR payment_state <> 'POSTED'
     OR document_state NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
     OR document_type <> 'INVOICE'
     OR payment_supplier_id <> NEW.supplier_id
     OR document_supplier_id <> NEW.supplier_id
     OR payment_legal_entity_id <> NEW.legal_entity_id
     OR document_legal_entity_id <> NEW.legal_entity_id THEN
    RAISE EXCEPTION 'supplier payment allocation does not match a posted invoice and payment';
  END IF;

  SELECT COALESCE(sum(active.amount), 0) INTO allocated_to_payment
  FROM app.supplier_payment_allocations active
  WHERE active.tenant_id = NEW.tenant_id
    AND active.payment_id = NEW.payment_id
    AND active.state = 'POSTED'
    AND NOT EXISTS (
      SELECT 1 FROM app.supplier_payment_allocations reversal
      WHERE reversal.tenant_id = active.tenant_id
        AND reversal.reversal_of_id = active.id
        AND reversal.state = 'REVERSED'
    );
  SELECT COALESCE(sum(active.amount), 0) INTO allocated_to_document
  FROM app.supplier_payment_allocations active
  WHERE active.tenant_id = NEW.tenant_id
    AND active.document_id = NEW.document_id
    AND active.state = 'POSTED'
    AND NOT EXISTS (
      SELECT 1 FROM app.supplier_payment_allocations reversal
      WHERE reversal.tenant_id = active.tenant_id
        AND reversal.reversal_of_id = active.id
        AND reversal.state = 'REVERSED'
    );
  IF allocated_to_payment > payment_amount OR allocated_to_document > document_amount THEN
    RAISE EXCEPTION 'supplier payment allocation exceeds its authoritative balance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER supplier_payment_allocations_total_guard
AFTER INSERT OR UPDATE OR DELETE ON app.supplier_payment_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_payment_allocation_guard();

-- Every A7 row is fail-closed behind the existing tenant context and active membership.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'suppliers', 'supplier_documents', 'supplier_document_delivery_refs',
    'supplier_payments', 'supplier_payment_allocations', 'supplier_account_movements'
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
    GRANT SELECT, INSERT, UPDATE ON app.suppliers, app.supplier_documents, app.supplier_payments TO app_runtime;
    GRANT SELECT, INSERT ON app.supplier_document_delivery_refs, app.supplier_payment_allocations, app.supplier_account_movements TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.suppliers, app.supplier_documents, app.supplier_document_delivery_refs, app.supplier_payments, app.supplier_payment_allocations, app.supplier_account_movements TO diagnostics_readonly;
  END IF;
END
$$;

-- These tables are facts, not mutable balance snapshots.  Corrections are new
-- reversal/adjustment rows linked to the original fact.
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON
  app.supplier_document_delivery_refs, app.supplier_payment_allocations,
  app.supplier_account_movements
FROM app_runtime;
