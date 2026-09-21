CREATE TABLE "app"."meter_boundaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"nozzle_id" uuid NOT NULL,
	"meter_installation_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reading_status" text NOT NULL,
	"reading_value" numeric(18, 3),
	"unavailable_reason" text,
	"effective_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"entered_by" uuid NOT NULL,
	"attendant_id" uuid NOT NULL,
	"on_behalf_of" uuid,
	"exception_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_boundaries_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_boundaries_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."meter_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"nozzle_id" uuid NOT NULL,
	"meter_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"installed_by" uuid NOT NULL,
	"replacement_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_installations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_installations_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."meter_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"nozzle_id" uuid NOT NULL,
	"meter_installation_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"opening_boundary_id" uuid NOT NULL,
	"closing_boundary_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"attendant_id" uuid NOT NULL,
	"entered_by" uuid NOT NULL,
	"on_behalf_of" uuid,
	"opening_reading" numeric(18, 3) NOT NULL,
	"closing_reading" numeric(18, 3) NOT NULL,
	"litres" numeric(18, 3) NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"expected_sale_value" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"boundary_reason" text NOT NULL,
	"segment_start_at" timestamp with time zone NOT NULL,
	"segment_end_at" timestamp with time zone NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	"controlled_exception" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_segments_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "meter_segments_opening_boundary_uidx" UNIQUE("tenant_id","station_id","opening_boundary_id"),
	CONSTRAINT "meter_segments_closing_boundary_uidx" UNIQUE("tenant_id","station_id","closing_boundary_id")
);
--> statement-breakpoint
CREATE TABLE "app"."meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meters_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "meters_tenant_serial_uidx" UNIQUE("tenant_id","serial_number")
);
--> statement-breakpoint
CREATE TABLE "app"."nozzles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"pump_id" uuid NOT NULL,
	"number" text NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nozzles_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "nozzles_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "nozzles_tenant_pump_number_uidx" UNIQUE("tenant_id","pump_id","number")
);
--> statement-breakpoint
CREATE TABLE "app"."payment_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reconciliation_revision_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"declared_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_declarations_tenant_id_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_tenant_code_uidx" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "app"."pumps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pumps_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "pumps_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "pumps_tenant_station_number_uidx" UNIQUE("tenant_id","station_id","number")
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"state" text DEFAULT 'READY' NOT NULL,
	"expected_sales" numeric(20, 4) NOT NULL,
	"accounted_sales" numeric(20, 4) NOT NULL,
	"variance" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"variance_classification" text NOT NULL,
	"variance_explanation" text,
	"declarations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_by" uuid,
	"approved_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_revisions_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_revisions_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "reconciliation_revisions_number_uidx" UNIQUE("tenant_id","reconciliation_id","revision")
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliations_business_day_uidx" UNIQUE("tenant_id","station_id","business_day_id"),
	CONSTRAINT "reconciliations_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."selling_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"unit_price" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selling_prices_tenant_id_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"state" text DEFAULT 'PLANNED' NOT NULL,
	"planned_start_at" timestamp with time zone NOT NULL,
	"planned_end_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"meter_closed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"not_operated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "shifts_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."station_business_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"business_date" text NOT NULL,
	"state" text DEFAULT 'NOT_STARTED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_business_days_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "station_business_days_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "station_business_days_station_date_uidx" UNIQUE("tenant_id","station_id","business_date")
);
--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_nozzle_fk" FOREIGN KEY ("tenant_id","station_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_installation_fk" FOREIGN KEY ("tenant_id","station_id","meter_installation_id") REFERENCES "app"."meter_installations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_business_day_fk" FOREIGN KEY ("tenant_id","station_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_shift_fk" FOREIGN KEY ("tenant_id","station_id","shift_id") REFERENCES "app"."shifts"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_confirmed_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_attendant_fk" FOREIGN KEY ("tenant_id","attendant_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_on_behalf_of_fk" FOREIGN KEY ("tenant_id","on_behalf_of") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_tenant_nozzle_fk" FOREIGN KEY ("tenant_id","station_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_tenant_meter_fk" FOREIGN KEY ("tenant_id","meter_id") REFERENCES "app"."meters"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_installed_by_fk" FOREIGN KEY ("tenant_id","installed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_nozzle_fk" FOREIGN KEY ("tenant_id","station_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_installation_fk" FOREIGN KEY ("tenant_id","station_id","meter_installation_id") REFERENCES "app"."meter_installations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_opening_boundary_fk" FOREIGN KEY ("tenant_id","station_id","opening_boundary_id") REFERENCES "app"."meter_boundaries"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_closing_boundary_fk" FOREIGN KEY ("tenant_id","station_id","closing_boundary_id") REFERENCES "app"."meter_boundaries"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_business_day_fk" FOREIGN KEY ("tenant_id","station_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_shift_fk" FOREIGN KEY ("tenant_id","station_id","shift_id") REFERENCES "app"."shifts"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_attendant_fk" FOREIGN KEY ("tenant_id","attendant_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_on_behalf_of_fk" FOREIGN KEY ("tenant_id","on_behalf_of") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meters" ADD CONSTRAINT "meters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nozzles" ADD CONSTRAINT "nozzles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nozzles" ADD CONSTRAINT "nozzles_tenant_station_pump_fk" FOREIGN KEY ("tenant_id","station_id","pump_id") REFERENCES "app"."pumps"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nozzles" ADD CONSTRAINT "nozzles_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_declarations" ADD CONSTRAINT "payment_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_declarations" ADD CONSTRAINT "payment_declarations_revision_fk" FOREIGN KEY ("tenant_id","reconciliation_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_declarations" ADD CONSTRAINT "payment_declarations_declared_by_fk" FOREIGN KEY ("tenant_id","declared_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pumps" ADD CONSTRAINT "pumps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pumps" ADD CONSTRAINT "pumps_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_business_day_fk" FOREIGN KEY ("tenant_id","station_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shifts" ADD CONSTRAINT "shifts_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shifts" ADD CONSTRAINT "shifts_business_day_fk" FOREIGN KEY ("tenant_id","station_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."station_business_days" ADD CONSTRAINT "station_business_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."station_business_days" ADD CONSTRAINT "station_business_days_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meter_boundaries_operational_lookup_idx" ON "app"."meter_boundaries" USING btree ("tenant_id","nozzle_id","effective_at");--> statement-breakpoint
CREATE INDEX "meter_installations_tenant_nozzle_effective_idx" ON "app"."meter_installations" USING btree ("tenant_id","nozzle_id","effective_from");--> statement-breakpoint
CREATE INDEX "meter_segments_reconciliation_lookup_idx" ON "app"."meter_segments" USING btree ("tenant_id","business_day_id","station_id");--> statement-breakpoint
CREATE INDEX "nozzles_tenant_station_idx" ON "app"."nozzles" USING btree ("tenant_id","station_id");--> statement-breakpoint
CREATE INDEX "payment_declarations_revision_idx" ON "app"."payment_declarations" USING btree ("tenant_id","reconciliation_revision_id");--> statement-breakpoint
CREATE INDEX "products_tenant_status_idx" ON "app"."products" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "pumps_tenant_station_idx" ON "app"."pumps" USING btree ("tenant_id","station_id");--> statement-breakpoint
CREATE INDEX "reconciliation_revisions_state_idx" ON "app"."reconciliation_revisions" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "reconciliations_station_state_idx" ON "app"."reconciliations" USING btree ("tenant_id","station_id","state");--> statement-breakpoint
CREATE INDEX "selling_prices_effective_lookup_idx" ON "app"."selling_prices" USING btree ("tenant_id","station_id","product_id","effective_from");--> statement-breakpoint
CREATE INDEX "shifts_station_day_state_idx" ON "app"."shifts" USING btree ("tenant_id","station_id","business_day_id","state");--> statement-breakpoint
CREATE INDEX "station_business_days_station_state_idx" ON "app"."station_business_days" USING btree ("tenant_id","station_id","state");

-- Reviewed A3 integrity and security layer.
CREATE EXTENSION IF NOT EXISTS btree_gist;
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('business_day.view', 'View station business days'), ('business_day.open', 'Open a station business day'),
  ('shift.view', 'View station shifts'), ('shift.start', 'Start a planned shift'), ('shift.close', 'Close shift meters and complete operations'),
  ('shift.exceptionally_close', 'Exceptionally close a shift'), ('shift.mark_not_operated', 'Mark a planned shift as not operated'),
  ('meter.view', 'View meter installations and readings'), ('meter.boundary.capture', 'Capture a confirmed meter boundary'),
  ('meter.correction.request', 'Request a controlled meter correction'), ('meter.replace', 'Replace a meter installation'),
  ('price.view', 'View effective selling prices'), ('price.change.request', 'Request a selling price change'),
  ('price.change.approve', 'Approve a selling price change'), ('price.change.activate', 'Activate an approved selling price boundary'),
  ('reconciliation.view', 'View station reconciliations'), ('reconciliation.submit', 'Submit a reconciliation revision'),
  ('reconciliation.return', 'Return a reconciliation for correction'), ('reconciliation.approve', 'Approve a reconciliation revision'),
  ('reconciliation.post', 'Post an approved reconciliation revision'), ('approval.view', 'View approval requests'),
  ('approval.act', 'Act on an approval request'), ('exception.view', 'View operational exceptions'), ('exception.manage', 'Resolve operational exceptions')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE app.station_business_days ADD CONSTRAINT station_business_days_state_ck CHECK (state IN ('NOT_STARTED', 'OPEN', 'OPERATIONS_COMPLETE', 'CLOSED', 'EXCEPTIONALLY_CLOSED', 'LOCKED'));
ALTER TABLE app.reconciliations ADD CONSTRAINT reconciliations_state_ck CHECK (state IN ('DRAFT', 'READY', 'SUBMITTED', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED', 'POSTED', 'LOCKED'));
ALTER TABLE app.reconciliation_revisions ADD CONSTRAINT reconciliation_revisions_state_ck CHECK (state IN ('READY', 'SUBMITTED', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED', 'POSTED', 'LOCKED'));
ALTER TABLE app.meter_boundaries ADD CONSTRAINT meter_boundaries_on_behalf_ck CHECK (on_behalf_of IS NULL OR on_behalf_of <> entered_by);
ALTER TABLE app.meter_segments ADD CONSTRAINT meter_segments_reading_ck CHECK (closing_reading >= opening_reading OR controlled_exception), ADD CONSTRAINT meter_segments_litres_ck CHECK (litres >= 0 AND (controlled_exception OR litres = closing_reading - opening_reading));
ALTER TABLE app.meter_installations ADD CONSTRAINT meter_installations_no_overlap EXCLUDE USING gist (tenant_id WITH =, station_id WITH =, nozzle_id WITH =, tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&);
ALTER TABLE app.meter_segments ADD CONSTRAINT meter_segments_nozzle_no_overlap EXCLUDE USING gist (tenant_id WITH =, station_id WITH =, nozzle_id WITH =, tstzrange(segment_start_at, segment_end_at, '[)') WITH &&);
ALTER TABLE app.selling_prices ADD CONSTRAINT selling_prices_effective_no_overlap EXCLUDE USING gist (tenant_id WITH =, station_id WITH =, product_id WITH =, tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&) WHERE (state <> 'CANCELLED');

CREATE OR REPLACE FUNCTION app.reject_authoritative_forecourt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'meter_segments' OR OLD.state IN ('APPROVED', 'POSTED', 'LOCKED', 'CLOSED', 'EXCEPTIONALLY_CLOSED') THEN RAISE EXCEPTION 'authoritative forecourt history is append-only'; END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'meter_segments' THEN
    RAISE EXCEPTION 'sealed meter segments are immutable; use a correction or reversal';
  ELSIF TG_TABLE_NAME = 'reconciliation_revisions' AND OLD.state IN ('SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'LOCKED') THEN
    IF OLD.state IN ('APPROVED', 'POSTED', 'LOCKED') OR NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.expected_sales IS DISTINCT FROM OLD.expected_sales OR NEW.accounted_sales IS DISTINCT FROM OLD.accounted_sales OR NEW.variance IS DISTINCT FROM OLD.variance OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.variance_classification IS DISTINCT FROM OLD.variance_classification OR NEW.declarations IS DISTINCT FROM OLD.declarations OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR (OLD.state <> 'PENDING_APPROVAL' AND NEW.variance_explanation IS DISTINCT FROM OLD.variance_explanation AND NEW.state <> 'RETURNED') THEN RAISE EXCEPTION 'submitted and posted reconciliation revision values are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'station_business_days' AND OLD.state IN ('CLOSED', 'EXCEPTIONALLY_CLOSED', 'LOCKED') THEN
    IF OLD.state <> 'CLOSED' OR NEW.state <> 'LOCKED' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.business_date IS DISTINCT FROM OLD.business_date THEN RAISE EXCEPTION 'closed and locked business days are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'selling_prices' AND OLD.state IN ('ACTIVE', 'FAILED_ACTIVATION') THEN
    RAISE EXCEPTION 'historical activated prices are immutable';
  ELSIF TG_TABLE_NAME = 'reconciliations' AND OLD.state IN ('APPROVED', 'POSTED', 'LOCKED') THEN
    RAISE EXCEPTION 'approved, posted, and locked reconciliations are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meter_segments_authoritative_guard ON app.meter_segments;
DROP TRIGGER IF EXISTS reconciliation_revisions_authoritative_guard ON app.reconciliation_revisions;
DROP TRIGGER IF EXISTS station_business_days_authoritative_guard ON app.station_business_days;
DROP TRIGGER IF EXISTS selling_prices_authoritative_guard ON app.selling_prices;
DROP TRIGGER IF EXISTS reconciliations_authoritative_guard ON app.reconciliations;
CREATE TRIGGER meter_segments_authoritative_guard BEFORE UPDATE OR DELETE ON app.meter_segments FOR EACH ROW EXECUTE FUNCTION app.reject_authoritative_forecourt_mutation();
CREATE TRIGGER reconciliation_revisions_authoritative_guard BEFORE UPDATE OR DELETE ON app.reconciliation_revisions FOR EACH ROW EXECUTE FUNCTION app.reject_authoritative_forecourt_mutation();
CREATE TRIGGER station_business_days_authoritative_guard BEFORE UPDATE OR DELETE ON app.station_business_days FOR EACH ROW EXECUTE FUNCTION app.reject_authoritative_forecourt_mutation();
CREATE TRIGGER selling_prices_authoritative_guard BEFORE UPDATE OR DELETE ON app.selling_prices FOR EACH ROW EXECUTE FUNCTION app.reject_authoritative_forecourt_mutation();
CREATE TRIGGER reconciliations_authoritative_guard BEFORE UPDATE OR DELETE ON app.reconciliations FOR EACH ROW EXECUTE FUNCTION app.reject_authoritative_forecourt_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['products', 'pumps', 'nozzles', 'meters', 'meter_installations', 'station_business_days', 'shifts', 'selling_prices', 'meter_boundaries', 'meter_segments', 'reconciliations', 'reconciliation_revisions', 'payment_declarations'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
  END LOOP;
END
$$;

-- The runtime role may create OPEN segment drafts, but it must not own the
-- authoritative OPEN -> SEALED transition. SealSegment uses this single
-- capability after application authorization, idempotency, and row locking.
CREATE OR REPLACE FUNCTION app.seal_meter_segment(
  p_tenant_id uuid,
  p_station_id uuid,
  p_segment_id uuid,
  p_expected_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE sealed_id uuid;
BEGIN
  -- Production uses app_runtime; the repository's local/CI database URL is
  -- the postgres application owner, which is already outside the ordinary
  -- runtime privilege boundary. Direct table UPDATE remains revoked for
  -- app_runtime in either deployment shape.
  IF session_user NOT IN ('app_runtime', 'postgres') THEN
    RAISE EXCEPTION 'meter segment sealing is restricted to the application runtime role';
  END IF;
  IF p_expected_version < 0
     OR app.current_tenant_id() IS DISTINCT FROM p_tenant_id
     OR current_setting('app.station_id', true) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR current_setting('app.station_id', true)::uuid IS DISTINCT FROM p_station_id
     OR NOT app.has_active_membership() THEN
    RAISE EXCEPTION 'trusted station context is required for meter segment sealing';
  END IF;

  UPDATE app.meter_segments
  SET state = 'SEALED', version = version + 1
  WHERE tenant_id = p_tenant_id
    AND station_id = p_station_id
    AND id = p_segment_id
    AND state = 'OPEN'
    AND version = p_expected_version
  RETURNING id INTO sealed_id;

  IF sealed_id IS NULL THEN RETURN NULL; END IF;
  RETURN sealed_id;
END;
$$;
REVOKE ALL ON FUNCTION app.seal_meter_segment(uuid, uuid, uuid, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.seal_meter_segment(uuid, uuid, uuid, integer) TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.seal_meter_segment(uuid, uuid, uuid, integer) OWNER TO migration_owner;
  END IF;
END
$$;

-- Consolidated A3 closure DDL. A3 uses the existing A1 platform.security_events
-- table for audit; no parallel forecourt audit table is created.
CREATE TABLE "app"."forecourt_idempotency_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "command_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text DEFAULT 'IN_PROGRESS' NOT NULL,
  "result_payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "forecourt_idempotency_tenant_command_key_uidx" UNIQUE("tenant_id","command_type","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "app"."forecourt_outbox" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_version" integer NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  CONSTRAINT "forecourt_outbox_tenant_event_uidx" UNIQUE("tenant_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "posted_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."forecourt_idempotency_records" ADD CONSTRAINT "forecourt_idempotency_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_outbox" ADD CONSTRAINT "forecourt_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_outbox" ADD CONSTRAINT "forecourt_outbox_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_locked_by_fk" FOREIGN KEY ("tenant_id","locked_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecourt_idempotency_tenant_created_idx" ON "app"."forecourt_idempotency_records" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "forecourt_outbox_unpublished_idx" ON "app"."forecourt_outbox" USING btree ("tenant_id","created_at");
--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD COLUMN "correction_of_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD COLUMN "reversal_of_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "correction_of_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id");--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_correction_of_fk" FOREIGN KEY ("tenant_id","station_id","correction_of_segment_id") REFERENCES "app"."meter_segments"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_reversal_of_fk" FOREIGN KEY ("tenant_id","station_id","reversal_of_segment_id") REFERENCES "app"."meter_segments"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_source_revision_fk" FOREIGN KEY ("tenant_id","station_id","source_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_correction_of_fk" FOREIGN KEY ("tenant_id","station_id","correction_of_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD COLUMN "state" text DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE app.meter_segments ADD CONSTRAINT meter_segments_state_ck CHECK (state IN ('OPEN', 'SEALED'));--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_shift_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE app.payment_declarations ADD CONSTRAINT payment_declarations_category_ck CHECK (category IN ('CASH', 'ELECTRONIC', 'CUSTOMER_ACCOUNT', 'PREPAID', 'BENEFIT_INTERNAL', 'OTHER'));--> statement-breakpoint
ALTER TABLE app.payment_declarations ADD CONSTRAINT payment_declarations_amount_ck CHECK (amount >= 0);--> statement-breakpoint
ALTER TABLE app.payment_declarations ADD CONSTRAINT payment_declarations_currency_ck CHECK (currency = 'USD');--> statement-breakpoint
ALTER TABLE app.reconciliation_revisions ADD CONSTRAINT reconciliation_revisions_variance_classification_ck CHECK (variance_classification IN ('INFORMATIONAL', 'REQUIRES_EXPLANATION', 'BLOCKING'));--> statement-breakpoint
ALTER TABLE app.reconciliation_revisions ADD CONSTRAINT reconciliation_revisions_currency_ck CHECK (currency = 'USD');--> statement-breakpoint
ALTER TABLE app.forecourt_idempotency_records ADD CONSTRAINT forecourt_idempotency_status_ck CHECK (status IN ('IN_PROGRESS', 'COMPLETED'));--> statement-breakpoint
ALTER TABLE app.forecourt_idempotency_records ADD CONSTRAINT forecourt_idempotency_key_ck CHECK (btrim(idempotency_key) <> '' AND btrim(request_hash) <> '');
DO $$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER SCHEMA app OWNER TO migration_owner;
    FOREACH table_name IN ARRAY ARRAY['products', 'pumps', 'nozzles', 'meters', 'meter_installations', 'station_business_days', 'shifts', 'selling_prices', 'meter_boundaries', 'meter_segments', 'reconciliations', 'reconciliation_revisions', 'payment_declarations'] LOOP EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name); END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON app.products, app.pumps, app.nozzles, app.meters, app.meter_installations, app.station_business_days, app.shifts, app.selling_prices, app.meter_boundaries, app.meter_segments, app.reconciliations, app.reconciliation_revisions, app.payment_declarations TO app_runtime; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN GRANT SELECT ON app.products, app.pumps, app.nozzles, app.meters, app.meter_installations, app.station_business_days, app.shifts, app.selling_prices, app.meter_boundaries, app.meter_segments, app.reconciliations, app.reconciliation_revisions, app.payment_declarations TO job_runtime; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN GRANT SELECT ON app.products, app.pumps, app.nozzles, app.meters, app.meter_installations, app.station_business_days, app.shifts, app.selling_prices, app.meter_boundaries, app.meter_segments, app.reconciliations, app.reconciliation_revisions, app.payment_declarations TO diagnostics_readonly; END IF;
END
$$;

INSERT INTO platform.permission_definitions (code, description)
VALUES ('business_day.lock', 'Lock a closed station business day')
ON CONFLICT (code) DO NOTHING;
INSERT INTO platform.permission_definitions (code, description)
VALUES ('business_day.close', 'Close an operationally complete station business day')
ON CONFLICT (code) DO NOTHING;
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('OWNER', 'business_day.close'), ('ADMINISTRATOR', 'business_day.close'), ('SUPERVISOR', 'business_day.close')
ON CONFLICT DO NOTHING;
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('OWNER', 'business_day.lock'), ('ADMINISTRATOR', 'business_day.lock'), ('FINANCE', 'business_day.lock')
ON CONFLICT DO NOTHING;
INSERT INTO platform.permission_definitions (code, description)
VALUES
  ('meter.reset', 'Reset a meter under controlled workflow'),
  ('meter.correction.execute', 'Create an authorized meter correction'),
  ('price.change.boundary', 'Prepare a boundary for an approved price activation cycle')
ON CONFLICT (code) DO NOTHING;
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'meter.reset'), ('ADMINISTRATOR', 'meter.reset'), ('SUPERVISOR', 'meter.reset'),
  ('OWNER', 'meter.correction.execute'), ('ADMINISTRATOR', 'meter.correction.execute'), ('SUPERVISOR', 'meter.correction.execute'),
  ('OWNER', 'price.change.boundary'), ('ADMINISTRATOR', 'price.change.boundary'), ('SUPERVISOR', 'price.change.boundary')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.enforce_forecourt_initial_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'meter_segments' AND NEW.state <> 'OPEN' THEN
    RAISE EXCEPTION 'meter segments must be inserted as OPEN';
  ELSIF TG_TABLE_NAME = 'station_business_days' AND NEW.state <> 'NOT_STARTED' THEN
    RAISE EXCEPTION 'station business days must be inserted as NOT_STARTED';
  ELSIF TG_TABLE_NAME = 'shifts' AND NEW.state <> 'PLANNED' THEN
    RAISE EXCEPTION 'shifts must be inserted as PLANNED';
  ELSIF TG_TABLE_NAME = 'reconciliations' AND NEW.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'reconciliations must be inserted as DRAFT';
  ELSIF TG_TABLE_NAME = 'reconciliation_revisions' AND NEW.state <> 'READY' THEN
    RAISE EXCEPTION 'reconciliation revisions must be inserted as READY';
  ELSIF TG_TABLE_NAME = 'selling_prices' AND NEW.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'selling prices must be inserted as DRAFT';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS station_business_days_initial_state_guard ON app.station_business_days;
DROP TRIGGER IF EXISTS shifts_initial_state_guard ON app.shifts;
DROP TRIGGER IF EXISTS reconciliations_initial_state_guard ON app.reconciliations;
DROP TRIGGER IF EXISTS reconciliation_revisions_initial_state_guard ON app.reconciliation_revisions;
DROP TRIGGER IF EXISTS selling_prices_initial_state_guard ON app.selling_prices;
DROP TRIGGER IF EXISTS meter_segments_initial_state_guard ON app.meter_segments;
CREATE TRIGGER station_business_days_initial_state_guard BEFORE INSERT ON app.station_business_days FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER shifts_initial_state_guard BEFORE INSERT ON app.shifts FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER reconciliations_initial_state_guard BEFORE INSERT ON app.reconciliations FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER reconciliation_revisions_initial_state_guard BEFORE INSERT ON app.reconciliation_revisions FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER selling_prices_initial_state_guard BEFORE INSERT ON app.selling_prices FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER meter_segments_initial_state_guard BEFORE INSERT ON app.meter_segments FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();

CREATE OR REPLACE FUNCTION app.validate_reconciliation_revision_payload()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE declaration jsonb;
BEGIN
  IF jsonb_typeof(NEW.declarations) <> 'array' OR jsonb_typeof(NEW.source_segment_ids) <> 'array' OR jsonb_typeof(NEW.source_shift_ids) <> 'array' THEN
    RAISE EXCEPTION 'reconciliation declarations and source lineage must be JSON arrays';
  END IF;
  FOR declaration IN SELECT value FROM jsonb_array_elements(NEW.declarations) LOOP
    IF jsonb_typeof(declaration) <> 'object'
       OR declaration->>'category' NOT IN ('CASH', 'ELECTRONIC', 'CUSTOMER_ACCOUNT', 'PREPAID', 'BENEFIT_INTERNAL', 'OTHER')
       OR declaration->>'declaredBy' IS NULL OR btrim(declaration->>'declaredBy') = ''
       OR declaration->>'amount' IS NULL OR (declaration->>'amount') !~ '^[0-9]+([.][0-9]+)?$'
       OR (declaration->>'amount')::numeric < 0
       OR (declaration ? 'currency' AND declaration->>'currency' <> NEW.currency) THEN
      RAISE EXCEPTION 'reconciliation declaration has an invalid category, amount, currency, or provenance';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.source_segment_ids) AS source(value)
    WHERE jsonb_typeof(source.value) <> 'string' OR source.value #>> '{}' !~ '^[0-9a-fA-F-]{36}$') THEN
    RAISE EXCEPTION 'reconciliation source segment lineage contains a non-UUID value';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.source_shift_ids) AS source(value)
    WHERE jsonb_typeof(source.value) <> 'string' OR source.value #>> '{}' !~ '^[0-9a-fA-F-]{36}$') THEN
    RAISE EXCEPTION 'reconciliation source shift lineage contains a non-UUID value';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reconciliation_revisions_payload_guard ON app.reconciliation_revisions;
CREATE TRIGGER reconciliation_revisions_payload_guard BEFORE INSERT OR UPDATE ON app.reconciliation_revisions FOR EACH ROW EXECUTE FUNCTION app.validate_reconciliation_revision_payload();

CREATE OR REPLACE FUNCTION app.enforce_forecourt_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'reconciliation_revisions' THEN
    IF NEW.state IN ('APPROVED', 'POSTED') AND NEW.variance_classification = 'BLOCKING' THEN
      RAISE EXCEPTION 'blocking reconciliation variance requires a corrected or resolved revision';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'station_business_days' THEN
    allowed := (OLD.state, NEW.state) IN (('NOT_STARTED','OPEN'),('OPEN','OPERATIONS_COMPLETE'),('OPERATIONS_COMPLETE','CLOSED'),('CLOSED','LOCKED'),('NOT_STARTED','EXCEPTIONALLY_CLOSED'),('OPEN','EXCEPTIONALLY_CLOSED'),('OPERATIONS_COMPLETE','EXCEPTIONALLY_CLOSED'));
  ELSIF TG_TABLE_NAME = 'shifts' THEN
    allowed := (OLD.state, NEW.state) IN (('PLANNED','OPEN'),('OPEN','METER_CLOSED'),('METER_CLOSED','COMPLETED'),('PLANNED','NOT_OPERATED'),('PLANNED','CANCELLED_BEFORE_START'),('OPEN','EXCEPTIONALLY_CLOSED'),('METER_CLOSED','EXCEPTIONALLY_CLOSED'));
  ELSIF TG_TABLE_NAME IN ('reconciliations','reconciliation_revisions') THEN
    allowed := (OLD.state, NEW.state) IN (('DRAFT','READY'),('READY','SUBMITTED'),('SUBMITTED','PENDING_APPROVAL'),('PENDING_APPROVAL','RETURNED'),('PENDING_APPROVAL','REJECTED'),('PENDING_APPROVAL','APPROVED'),('APPROVED','POSTED'),('POSTED','LOCKED'));
  ELSIF TG_TABLE_NAME = 'selling_prices' THEN
    allowed := (OLD.state, NEW.state) IN (('DRAFT','PENDING_APPROVAL'),('PENDING_APPROVAL','APPROVED'),('PENDING_APPROVAL','CANCELLED'),('APPROVED','SCHEDULED'),('APPROVED','PENDING_STATION_ACTIVATION'),('APPROVED','CANCELLED'),('SCHEDULED','PENDING_STATION_ACTIVATION'),('SCHEDULED','CANCELLED'),('PENDING_STATION_ACTIVATION','BOUNDARIES_IN_PROGRESS'),('PENDING_STATION_ACTIVATION','FAILED_ACTIVATION'),('BOUNDARIES_IN_PROGRESS','ACTIVE'),('BOUNDARIES_IN_PROGRESS','FAILED_ACTIVATION'),('FAILED_ACTIVATION','PENDING_STATION_ACTIVATION'),('FAILED_ACTIVATION','CANCELLED'));
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'forbidden direct forecourt workflow transition: % -> % on %', OLD.state, NEW.state, TG_TABLE_NAME; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS station_business_days_transition_guard ON app.station_business_days;
DROP TRIGGER IF EXISTS shifts_transition_guard ON app.shifts;
DROP TRIGGER IF EXISTS reconciliations_transition_guard ON app.reconciliations;
DROP TRIGGER IF EXISTS reconciliation_revisions_transition_guard ON app.reconciliation_revisions;
DROP TRIGGER IF EXISTS selling_prices_transition_guard ON app.selling_prices;
CREATE TRIGGER station_business_days_transition_guard BEFORE UPDATE OF state ON app.station_business_days FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER shifts_transition_guard BEFORE UPDATE OF state ON app.shifts FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER reconciliations_transition_guard BEFORE UPDATE OF state ON app.reconciliations FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER reconciliation_revisions_transition_guard BEFORE UPDATE OF state ON app.reconciliation_revisions FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER selling_prices_transition_guard BEFORE UPDATE OF state ON app.selling_prices FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();

CREATE OR REPLACE FUNCTION app.reject_authoritative_forecourt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'meter_segments' THEN
      RAISE EXCEPTION 'sealed meter segments are immutable; use a correction or reversal';
    ELSIF OLD.state IN ('APPROVED','POSTED','LOCKED','CLOSED','EXCEPTIONALLY_CLOSED') THEN
      RAISE EXCEPTION 'authoritative forecourt history is append-only';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'meter_segments' THEN
    IF OLD.state <> 'OPEN' OR NEW.state <> 'SEALED' OR NEW.version <> OLD.version + 1
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id
      OR NEW.nozzle_id IS DISTINCT FROM OLD.nozzle_id OR NEW.meter_installation_id IS DISTINCT FROM OLD.meter_installation_id
      OR NEW.business_day_id IS DISTINCT FROM OLD.business_day_id OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
      OR NEW.opening_boundary_id IS DISTINCT FROM OLD.opening_boundary_id OR NEW.closing_boundary_id IS DISTINCT FROM OLD.closing_boundary_id
      OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.attendant_id IS DISTINCT FROM OLD.attendant_id
      OR NEW.entered_by IS DISTINCT FROM OLD.entered_by OR NEW.on_behalf_of IS DISTINCT FROM OLD.on_behalf_of
      OR NEW.correction_of_segment_id IS DISTINCT FROM OLD.correction_of_segment_id OR NEW.reversal_of_segment_id IS DISTINCT FROM OLD.reversal_of_segment_id
      OR NEW.opening_reading IS DISTINCT FROM OLD.opening_reading OR NEW.closing_reading IS DISTINCT FROM OLD.closing_reading
      OR NEW.litres IS DISTINCT FROM OLD.litres OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
      OR NEW.selling_price_id IS DISTINCT FROM OLD.selling_price_id
      OR NEW.expected_sale_value IS DISTINCT FROM OLD.expected_sale_value OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.boundary_reason IS DISTINCT FROM OLD.boundary_reason OR NEW.segment_start_at IS DISTINCT FROM OLD.segment_start_at
      OR NEW.segment_end_at IS DISTINCT FROM OLD.segment_end_at OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
      OR NEW.controlled_exception IS DISTINCT FROM OLD.controlled_exception OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'meter segments only permit OPEN to SEALED transition; use a correction or reversal';
    END IF;
  ELSIF TG_TABLE_NAME = 'reconciliation_revisions' THEN
    IF OLD.state = 'LOCKED' THEN RAISE EXCEPTION 'locked reconciliation revisions are immutable'; END IF;
    IF OLD.state = 'RETURNED' THEN RAISE EXCEPTION 'returned reconciliation revisions are immutable; create a correction revision'; END IF;
    IF OLD.state IN ('APPROVED','POSTED') AND NOT (
      OLD.state = 'APPROVED' AND NEW.state = 'POSTED' AND NEW.posted_by IS NOT NULL AND NEW.posted_at IS NOT NULL
      OR OLD.state = 'POSTED' AND NEW.state = 'LOCKED' AND NEW.locked_by IS NOT NULL AND NEW.locked_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'approved and posted reconciliation revisions only accept named provenance transitions'; END IF;
    IF OLD.state IN ('SUBMITTED','PENDING_APPROVAL','APPROVED','POSTED') AND (
      NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.revision IS DISTINCT FROM OLD.revision
      OR NEW.expected_sales IS DISTINCT FROM OLD.expected_sales OR NEW.accounted_sales IS DISTINCT FROM OLD.accounted_sales OR NEW.variance IS DISTINCT FROM OLD.variance
      OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.variance_classification IS DISTINCT FROM OLD.variance_classification OR NEW.declarations IS DISTINCT FROM OLD.declarations
      OR NEW.source_segment_ids IS DISTINCT FROM OLD.source_segment_ids OR NEW.source_shift_ids IS DISTINCT FROM OLD.source_shift_ids
      OR NEW.source_revision_id IS DISTINCT FROM OLD.source_revision_id OR NEW.correction_of_revision_id IS DISTINCT FROM OLD.correction_of_revision_id
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR (NEW.approved_by IS DISTINCT FROM OLD.approved_by AND NOT (OLD.state = 'PENDING_APPROVAL' AND NEW.state = 'APPROVED'))
      OR (NEW.approved_at IS DISTINCT FROM OLD.approved_at AND NOT (OLD.state = 'PENDING_APPROVAL' AND NEW.state = 'APPROVED'))
      OR (NEW.posted_by IS DISTINCT FROM OLD.posted_by AND NOT (OLD.state = 'APPROVED' AND NEW.state = 'POSTED'))
      OR (NEW.posted_at IS DISTINCT FROM OLD.posted_at AND NOT (OLD.state = 'APPROVED' AND NEW.state = 'POSTED'))
      OR (NEW.locked_by IS DISTINCT FROM OLD.locked_by AND NOT (OLD.state = 'POSTED' AND NEW.state = 'LOCKED'))
      OR (NEW.locked_at IS DISTINCT FROM OLD.locked_at AND NOT (OLD.state = 'POSTED' AND NEW.state = 'LOCKED'))
    ) THEN RAISE EXCEPTION 'authoritative reconciliation revision values are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'station_business_days' AND OLD.state IN ('CLOSED','EXCEPTIONALLY_CLOSED','LOCKED') THEN
    IF OLD.state <> 'CLOSED' OR NEW.state <> 'LOCKED' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.business_date IS DISTINCT FROM OLD.business_date THEN RAISE EXCEPTION 'closed and locked business days are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'selling_prices' AND OLD.state IN ('ACTIVE','FAILED_ACTIVATION') THEN
    RAISE EXCEPTION 'historical activated prices are immutable';
ELSIF TG_TABLE_NAME = 'reconciliations' AND OLD.state IN ('APPROVED','POSTED','LOCKED') THEN
    IF OLD.state = 'LOCKED' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.business_day_id IS DISTINCT FROM OLD.business_day_id THEN RAISE EXCEPTION 'approved, posted, and locked reconciliations are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.guard_forecourt_idempotency_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'forecourt idempotency records are append-only';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.command_type IS DISTINCT FROM OLD.command_type
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR (OLD.status = 'COMPLETED' AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.result_payload IS DISTINCT FROM OLD.result_payload
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     ))
     OR (OLD.status = 'IN_PROGRESS' AND NEW.status <> 'COMPLETED') THEN
    RAISE EXCEPTION 'forecourt idempotency records only permit IN_PROGRESS to COMPLETED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS forecourt_idempotency_mutation_guard ON app.forecourt_idempotency_records;
CREATE TRIGGER forecourt_idempotency_mutation_guard
BEFORE UPDATE OR DELETE ON app.forecourt_idempotency_records
FOR EACH ROW EXECUTE FUNCTION app.guard_forecourt_idempotency_mutation();

CREATE OR REPLACE FUNCTION app.guard_forecourt_outbox_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'forecourt outbox events are append-only';
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.station_id IS DISTINCT FROM OLD.station_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.event_version IS DISTINCT FROM OLD.event_version
     OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'forecourt outbox events only permit publication marking';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS forecourt_outbox_mutation_guard ON app.forecourt_outbox;
CREATE TRIGGER forecourt_outbox_mutation_guard
BEFORE UPDATE OR DELETE ON app.forecourt_outbox
FOR EACH ROW EXECUTE FUNCTION app.guard_forecourt_outbox_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['forecourt_idempotency_records', 'forecourt_outbox'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.forecourt_idempotency_records TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.forecourt_outbox TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT, UPDATE ON app.forecourt_outbox TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.forecourt_idempotency_records, app.forecourt_outbox TO diagnostics_readonly;
  END IF;
END
$$;

-- The broad A3 table grant above is retained for draft/open work on the other
-- forecourt tables. Meter segment UPDATE is intentionally capability-only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    REVOKE UPDATE, DELETE ON app.meter_segments FROM app_runtime;
  END IF;
END
$$;

-- Final A3 lineage and correction hardening. These statements remain in the
-- canonical, still-unmerged A3 migration.
ALTER TABLE app.meter_boundaries ADD COLUMN IF NOT EXISTS price_change_id uuid;
ALTER TABLE app.meter_segments ADD COLUMN IF NOT EXISTS selling_price_id uuid;
ALTER TABLE app.selling_prices
  ADD CONSTRAINT selling_prices_tenant_station_id_uidx UNIQUE (tenant_id, station_id, id);
ALTER TABLE app.meter_boundaries
  ADD CONSTRAINT meter_boundaries_price_change_fk
  FOREIGN KEY (tenant_id, station_id, price_change_id)
  REFERENCES app.selling_prices (tenant_id, station_id, id);
ALTER TABLE app.meter_segments
  ADD CONSTRAINT meter_segments_selling_price_fk
  FOREIGN KEY (tenant_id, station_id, selling_price_id)
  REFERENCES app.selling_prices (tenant_id, station_id, id);

ALTER TABLE app.meter_segments DROP CONSTRAINT IF EXISTS meter_segments_nozzle_no_overlap;
ALTER TABLE app.meter_segments
  ADD CONSTRAINT meter_segments_nozzle_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    station_id WITH =,
    nozzle_id WITH =,
    tstzrange(segment_start_at, segment_end_at, '[)') WITH &&
  ) WHERE (correction_of_segment_id IS NULL AND reversal_of_segment_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS meter_segments_one_correction_per_source_uidx
  ON app.meter_segments (tenant_id, station_id, correction_of_segment_id)
  WHERE correction_of_segment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meter_segments_one_reversal_per_source_uidx
  ON app.meter_segments (tenant_id, station_id, reversal_of_segment_id)
  WHERE reversal_of_segment_id IS NOT NULL;

-- A price activation cycle can establish only one qualifying boundary per
-- nozzle.  The cycle identity is the persisted price-change id; timestamps
-- are deliberately not used for this race-sensitive invariant.
CREATE UNIQUE INDEX IF NOT EXISTS meter_boundaries_one_price_cycle_per_nozzle_uidx
  ON app.meter_boundaries (tenant_id, station_id, nozzle_id, price_change_id)
  WHERE reason = 'PRICE_CHANGE'
    AND reading_status = 'AVAILABLE'
    AND price_change_id IS NOT NULL;
