CREATE TABLE "app"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"order_date" text NOT NULL,
	"expected_delivery_date" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_orders_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "purchase_orders_tenant_number_uidx" UNIQUE("tenant_id","order_number"),
	CONSTRAINT "purchase_orders_number_nonempty_ck" CHECK (btrim("order_number") <> ''),
	CONSTRAINT "purchase_orders_currency_ck" CHECK ("currency" = 'USD'),
	CONSTRAINT "purchase_orders_state_ck" CHECK ("state" in ('DRAFT','SUBMITTED','APPROVED','CANCELLED','CLOSED')),
	CONSTRAINT "purchase_orders_revision_ck" CHECK ("revision_no" >= 1),
	CONSTRAINT "purchase_orders_dates_ck" CHECK ("expected_delivery_date" is null or "expected_delivery_date" >= "order_date"),
	CONSTRAINT "purchase_orders_cancel_provenance_ck" CHECK ("state" <> 'CANCELLED' or ("cancelled_by" is not null and "cancelled_at" is not null and btrim(coalesce("cancellation_reason", '')) <> '')),
	CONSTRAINT "purchase_orders_close_provenance_ck" CHECK ("state" <> 'CLOSED' or ("closed_by" is not null and "closed_at" is not null and btrim(coalesce("close_reason", '')) <> '')),
	CONSTRAINT "purchase_orders_approval_provenance_ck" CHECK ("state" <> 'APPROVED' or ("approved_by" is not null and "approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"ordered_litres" numeric(18, 3) NOT NULL,
	"agreed_unit_price" numeric(20, 8),
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"short_closed_litres" numeric(18, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_lines_po_number_uidx" UNIQUE("tenant_id","purchase_order_id","line_number"),
	CONSTRAINT "purchase_order_lines_po_id_product_uidx" UNIQUE("tenant_id","purchase_order_id","id","product_id"),
	CONSTRAINT "purchase_order_lines_litres_ck" CHECK ("ordered_litres" > 0),
	CONSTRAINT "purchase_order_lines_price_ck" CHECK ("agreed_unit_price" is null or "agreed_unit_price" >= 0),
	CONSTRAINT "purchase_order_lines_status_ck" CHECK ("status" in ('ACTIVE','REMOVED')),
	CONSTRAINT "purchase_order_lines_short_closed_ck" CHECK ("short_closed_litres" is null or "short_closed_litres" >= 0),
	CONSTRAINT "purchase_order_lines_number_ck" CHECK ("line_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text,
	"actor_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_revisions_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_revisions_po_revision_uidx" UNIQUE("tenant_id","purchase_order_id","revision_no"),
	CONSTRAINT "purchase_order_revisions_no_ck" CHECK ("revision_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_delivery_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"linked_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_by" uuid,
	"unlinked_at" timestamp with time zone,
	"unlink_reason" text,
	CONSTRAINT "purchase_order_delivery_links_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_delivery_links_state_ck" CHECK ("state" in ('ACTIVE','UNLINKED')),
	CONSTRAINT "purchase_order_delivery_links_unlink_ck" CHECK ("state" <> 'UNLINKED' or ("unlinked_by" is not null and "unlinked_at" is not null and btrim(coalesce("unlink_reason", '')) <> ''))
);
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "app"."suppliers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_fk" FOREIGN KEY ("tenant_id","cancelled_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "app"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_po_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "app"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_delivery_links" ADD CONSTRAINT "purchase_order_delivery_links_po_fk" FOREIGN KEY ("tenant_id","station_id","purchase_order_id") REFERENCES "app"."purchase_orders"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_delivery_links" ADD CONSTRAINT "purchase_order_delivery_links_line_fk" FOREIGN KEY ("tenant_id","purchase_order_id","purchase_order_line_id","product_id") REFERENCES "app"."purchase_order_lines"("tenant_id","purchase_order_id","id","product_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_delivery_links" ADD CONSTRAINT "purchase_order_delivery_links_delivery_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id","product_id") REFERENCES "app"."fuel_deliveries"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_delivery_links" ADD CONSTRAINT "purchase_order_delivery_links_linked_by_fk" FOREIGN KEY ("tenant_id","linked_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_delivery_links" ADD CONSTRAINT "purchase_order_delivery_links_unlinked_by_fk" FOREIGN KEY ("tenant_id","unlinked_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_station_state_idx" ON "app"."purchase_orders" USING btree ("tenant_id","station_id","state");
--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_supplier_idx" ON "app"."purchase_orders" USING btree ("tenant_id","supplier_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_delivery_links_active_delivery_uidx" ON "app"."purchase_order_delivery_links" USING btree ("tenant_id","delivery_id") WHERE "state" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "purchase_order_delivery_links_po_idx" ON "app"."purchase_order_delivery_links" USING btree ("tenant_id","purchase_order_id","state");
--> statement-breakpoint

-- Purchase orders (ADR-018 D4): hand-authored security, integrity, and authorization layer.
-- The statements above are the tables/constraints/indexes for
-- src/platform/db/schema/purchasing.ts. A purchase order has no accounting effect: nothing
-- here touches inventory, cash, bank, or supplier-ledger tables.

INSERT INTO platform.permission_definitions (code, description) VALUES
  ('purchase_order.view', 'View purchase orders and their derived receipt status'),
  ('purchase_order.create', 'Create, submit, amend purchase orders and link deliveries to them'),
  ('purchase_order.approve', 'Approve a submitted purchase order'),
  ('purchase_order.cancel', 'Cancel or close a purchase order')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT role_code, permission_code
FROM (VALUES
  ('OWNER', 'purchase_order.view'), ('OWNER', 'purchase_order.create'),
  ('OWNER', 'purchase_order.approve'), ('OWNER', 'purchase_order.cancel'),
  ('ADMINISTRATOR', 'purchase_order.view'), ('ADMINISTRATOR', 'purchase_order.create'),
  ('ADMINISTRATOR', 'purchase_order.approve'), ('ADMINISTRATOR', 'purchase_order.cancel'),
  ('FINANCE', 'purchase_order.view'), ('FINANCE', 'purchase_order.create'),
  ('FINANCE', 'purchase_order.approve'), ('FINANCE', 'purchase_order.cancel'),
  ('SUPERVISOR', 'purchase_order.view'), ('SUPERVISOR', 'purchase_order.create')
) AS grants(role_code, permission_code)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_purchase_order_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  supplier_status text;
BEGIN
  SELECT status INTO supplier_status
  FROM app.suppliers
  WHERE tenant_id = NEW.tenant_id AND id = NEW.supplier_id;
  IF supplier_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'purchase order supplier must be active';
  END IF;
  IF NEW.state <> 'DRAFT' OR NEW.version <> 0 OR NEW.revision_no <> 1 THEN
    RAISE EXCEPTION 'purchase orders are created as draft, version 0, revision 1';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER purchase_orders_insert_guard
BEFORE INSERT ON app.purchase_orders
FOR EACH ROW EXECUTE FUNCTION app.a6_purchase_order_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_purchase_order_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
     NEW.station_id IS DISTINCT FROM OLD.station_id OR
     NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR
     NEW.order_number IS DISTINCT FROM OLD.order_number OR
     NEW.currency IS DISTINCT FROM OLD.currency OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'purchase order identity facts are immutable';
  END IF;
  IF OLD.state IN ('CANCELLED', 'CLOSED') AND (
       NEW IS DISTINCT FROM OLD
     ) THEN
    RAISE EXCEPTION 'cancelled and closed purchase orders are terminal';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT', 'SUBMITTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'draft purchase orders can only be submitted or cancelled';
  END IF;
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED', 'APPROVED', 'CANCELLED') THEN
    RAISE EXCEPTION 'submitted purchase orders can only be approved or cancelled';
  END IF;
  IF OLD.state = 'APPROVED' AND NEW.state NOT IN ('APPROVED', 'SUBMITTED', 'CLOSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'approved purchase orders can only be amended, closed, or cancelled';
  END IF;
  IF NEW.state = 'CANCELLED' AND OLD.state <> 'CANCELLED' AND EXISTS (
    SELECT 1
    FROM app.purchase_order_delivery_links l
    JOIN app.fuel_deliveries d ON d.tenant_id = l.tenant_id AND d.id = l.delivery_id
    WHERE l.tenant_id = NEW.tenant_id AND l.purchase_order_id = NEW.id
      AND l.state = 'ACTIVE' AND d.status = 'CONFIRMED'
  ) THEN
    RAISE EXCEPTION 'a purchase order with confirmed deliveries must be closed, not cancelled';
  END IF;
  IF NEW.revision_no < OLD.revision_no OR NEW.version < OLD.version THEN
    RAISE EXCEPTION 'purchase order version and revision never decrease';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER purchase_orders_state_guard
BEFORE UPDATE ON app.purchase_orders
FOR EACH ROW EXECUTE FUNCTION app.a6_purchase_order_state_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_purchase_order_line_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  po_state text;
BEGIN
  SELECT state INTO po_state
  FROM app.purchase_orders
  WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_order_id;
  IF po_state NOT IN ('DRAFT', 'SUBMITTED', 'APPROVED') THEN
    RAISE EXCEPTION 'lines of a % purchase order cannot change', po_state;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR
       NEW.line_number IS DISTINCT FROM OLD.line_number OR
       NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'purchase order line identity and product are immutable';
    END IF;
    IF OLD.status = 'REMOVED' AND NEW.status <> 'REMOVED' THEN
      RAISE EXCEPTION 'a removed purchase order line cannot be reinstated';
    END IF;
    IF NEW.status = 'REMOVED' AND OLD.status = 'ACTIVE' AND EXISTS (
      SELECT 1 FROM app.purchase_order_delivery_links
      WHERE tenant_id = NEW.tenant_id AND purchase_order_line_id = NEW.id AND state = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'a line with linked deliveries cannot be removed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER purchase_order_lines_guard
BEFORE INSERT OR UPDATE ON app.purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION app.a6_purchase_order_line_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_purchase_order_link_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  po_state text;
  line_status text;
  delivery_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT state INTO po_state FROM app.purchase_orders
    WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_order_id;
    IF po_state IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'deliveries can only be linked to an approved purchase order';
    END IF;
    SELECT status INTO line_status FROM app.purchase_order_lines
    WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_order_line_id;
    IF line_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'deliveries can only be linked to an active purchase order line';
    END IF;
    SELECT status INTO delivery_status FROM app.fuel_deliveries
    WHERE tenant_id = NEW.tenant_id AND id = NEW.delivery_id;
    IF delivery_status IS DISTINCT FROM 'DRAFT' AND delivery_status IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'only draft or confirmed deliveries can be linked';
    END IF;
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'links are created active';
    END IF;
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.station_id IS DISTINCT FROM OLD.station_id OR
       NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR
       NEW.purchase_order_line_id IS DISTINCT FROM OLD.purchase_order_line_id OR
       NEW.delivery_id IS DISTINCT FROM OLD.delivery_id OR
       NEW.product_id IS DISTINCT FROM OLD.product_id OR
       NEW.linked_by IS DISTINCT FROM OLD.linked_by OR
       NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
      RAISE EXCEPTION 'link facts are immutable; unlink and relink instead';
    END IF;
    IF OLD.state = 'UNLINKED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'an unlinked delivery link is final';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER purchase_order_delivery_links_guard
BEFORE INSERT OR UPDATE ON app.purchase_order_delivery_links
FOR EACH ROW EXECUTE FUNCTION app.a6_purchase_order_link_guard();
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'purchase_orders', 'purchase_order_lines', 'purchase_order_revisions',
    'purchase_order_delivery_links'
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
    GRANT SELECT, INSERT, UPDATE ON
      app.purchase_orders, app.purchase_order_lines, app.purchase_order_delivery_links
    TO app_runtime;
    GRANT SELECT, INSERT ON app.purchase_order_revisions TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON
      app.purchase_orders, app.purchase_order_lines, app.purchase_order_revisions,
      app.purchase_order_delivery_links
    TO diagnostics_readonly;
  END IF;
END
$$;
--> statement-breakpoint

-- Revision snapshots are facts: corrections are new revisions. The runtime role never deletes.
REVOKE UPDATE ON app.purchase_order_revisions FROM app_runtime;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON
  app.purchase_orders, app.purchase_order_lines, app.purchase_order_revisions,
  app.purchase_order_delivery_links
FROM app_runtime;
