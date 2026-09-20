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
	"on_behalf_of" uuid,
	"exception_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_boundaries_tenant_id_id_uidx" UNIQUE("tenant_id","id")
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
	CONSTRAINT "meter_installations_tenant_id_id_uidx" UNIQUE("tenant_id","id")
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
	CONSTRAINT "meter_segments_opening_boundary_uidx" UNIQUE("tenant_id","opening_boundary_id"),
	CONSTRAINT "meter_segments_closing_boundary_uidx" UNIQUE("tenant_id","closing_boundary_id")
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
	CONSTRAINT "pumps_tenant_station_number_uidx" UNIQUE("tenant_id","station_id","number")
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
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
	CONSTRAINT "reconciliations_business_day_uidx" UNIQUE("tenant_id","business_day_id")
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
	CONSTRAINT "shifts_tenant_id_id_uidx" UNIQUE("tenant_id","id")
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
	CONSTRAINT "station_business_days_station_date_uidx" UNIQUE("tenant_id","station_id","business_date")
);
--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_nozzle_fk" FOREIGN KEY ("tenant_id","station_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_installation_fk" FOREIGN KEY ("tenant_id","meter_installation_id") REFERENCES "app"."meter_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_business_day_fk" FOREIGN KEY ("tenant_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "app"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_confirmed_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_boundaries" ADD CONSTRAINT "meter_boundaries_on_behalf_of_fk" FOREIGN KEY ("tenant_id","on_behalf_of") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_tenant_nozzle_fk" FOREIGN KEY ("tenant_id","station_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_tenant_meter_fk" FOREIGN KEY ("tenant_id","meter_id") REFERENCES "app"."meters"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_installations" ADD CONSTRAINT "meter_installations_installed_by_fk" FOREIGN KEY ("tenant_id","installed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_nozzle_fk" FOREIGN KEY ("tenant_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_installation_fk" FOREIGN KEY ("tenant_id","meter_installation_id") REFERENCES "app"."meter_installations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_opening_boundary_fk" FOREIGN KEY ("tenant_id","opening_boundary_id") REFERENCES "app"."meter_boundaries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_closing_boundary_fk" FOREIGN KEY ("tenant_id","closing_boundary_id") REFERENCES "app"."meter_boundaries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_business_day_fk" FOREIGN KEY ("tenant_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "app"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_reconciliation_fk" FOREIGN KEY ("tenant_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_business_day_fk" FOREIGN KEY ("tenant_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."selling_prices" ADD CONSTRAINT "selling_prices_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shifts" ADD CONSTRAINT "shifts_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shifts" ADD CONSTRAINT "shifts_business_day_fk" FOREIGN KEY ("tenant_id","business_day_id") REFERENCES "app"."station_business_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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

-- A3 integrity and security layer. Drizzle owns the table metadata above;
-- these reviewed constraints enforce effective ranges, state vocabularies,
-- meter arithmetic, nozzle exclusivity, and fail-closed tenant access.
CREATE EXTENSION IF NOT EXISTS btree_gist;

INSERT INTO platform.permission_definitions (code, description) VALUES
  ('business_day.view', 'View station business days'),
  ('business_day.open', 'Open a station business day'),
  ('shift.view', 'View station shifts'),
  ('shift.start', 'Start a planned shift'),
  ('shift.close', 'Close shift meters and complete operations'),
  ('shift.exceptionally_close', 'Exceptionally close a shift'),
  ('shift.mark_not_operated', 'Mark a planned shift as not operated'),
  ('meter.view', 'View meter installations and readings'),
  ('meter.boundary.capture', 'Capture a confirmed meter boundary'),
  ('meter.correction.request', 'Request a controlled meter correction'),
  ('meter.replace', 'Replace a meter installation'),
  ('price.view', 'View effective selling prices'),
  ('price.change.request', 'Request a selling price change'),
  ('price.change.approve', 'Approve a selling price change'),
  ('price.change.activate', 'Activate an approved selling price boundary'),
  ('reconciliation.view', 'View station reconciliations'),
  ('reconciliation.submit', 'Submit a reconciliation revision'),
  ('reconciliation.return', 'Return a reconciliation for correction'),
  ('reconciliation.approve', 'Approve a reconciliation revision'),
  ('reconciliation.post', 'Post an approved reconciliation revision'),
  ('approval.view', 'View approval requests'),
  ('approval.act', 'Act on an approval request'),
  ('exception.view', 'View operational exceptions'),
  ('exception.manage', 'Resolve operational exceptions')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE app.products
  ADD CONSTRAINT products_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'));
ALTER TABLE app.pumps
  ADD CONSTRAINT pumps_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'));
ALTER TABLE app.nozzles
  ADD CONSTRAINT nozzles_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'));
ALTER TABLE app.meters
  ADD CONSTRAINT meters_status_ck CHECK (status IN ('ACTIVE', 'RETIRED', 'UNREADABLE'));
ALTER TABLE app.meter_installations
  ADD CONSTRAINT meter_installations_range_ck CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE app.station_business_days
  ADD CONSTRAINT station_business_days_date_ck CHECK (business_date ~ '^\d{4}-\d{2}-\d{2}$'),
  ADD CONSTRAINT station_business_days_state_ck CHECK (state IN ('NOT_STARTED', 'OPEN', 'OPERATIONS_COMPLETE', 'CLOSED', 'EXCEPTIONALLY_CLOSED'));
ALTER TABLE app.shifts
  ADD CONSTRAINT shifts_date_ck CHECK (business_date ~ '^\d{4}-\d{2}-\d{2}$'),
  ADD CONSTRAINT shifts_range_ck CHECK (planned_end_at > planned_start_at),
  ADD CONSTRAINT shifts_state_ck CHECK (state IN ('PLANNED', 'OPEN', 'METER_CLOSED', 'COMPLETED', 'NOT_OPERATED', 'CANCELLED_BEFORE_START', 'EXCEPTIONALLY_CLOSED'));
ALTER TABLE app.selling_prices
  ADD CONSTRAINT selling_prices_range_ck CHECK (effective_to IS NULL OR effective_to > effective_from),
  ADD CONSTRAINT selling_prices_currency_ck CHECK (currency = 'USD'),
  ADD CONSTRAINT selling_prices_state_ck CHECK (state IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS', 'ACTIVE', 'FAILED_ACTIVATION', 'CANCELLED'));
ALTER TABLE app.meter_boundaries
  ADD CONSTRAINT meter_boundaries_reason_ck CHECK (reason IN ('SHIFT_OPEN', 'SHIFT_CLOSE', 'ATTENDANT_HANDOVER', 'PRICE_CHANGE', 'DELIVERY', 'METER_RESET', 'REPLACEMENT', 'CORRECTION')),
  ADD CONSTRAINT meter_boundaries_reading_ck CHECK ((reading_status = 'AVAILABLE' AND reading_value IS NOT NULL AND unavailable_reason IS NULL) OR (reading_status = 'UNAVAILABLE' AND reading_value IS NULL AND length(trim(unavailable_reason)) > 0)),
  ADD CONSTRAINT meter_boundaries_on_behalf_ck CHECK (on_behalf_of IS NULL OR on_behalf_of <> entered_by);
ALTER TABLE app.meter_segments
  ADD CONSTRAINT meter_segments_reading_ck CHECK (closing_reading >= opening_reading OR controlled_exception),
  ADD CONSTRAINT meter_segments_litres_ck CHECK (litres >= 0 AND (controlled_exception OR litres = closing_reading - opening_reading)),
  ADD CONSTRAINT meter_segments_time_ck CHECK (segment_end_at > segment_start_at),
  ADD CONSTRAINT meter_segments_reason_ck CHECK (boundary_reason IN ('SHIFT_OPEN', 'SHIFT_CLOSE', 'ATTENDANT_HANDOVER', 'PRICE_CHANGE', 'DELIVERY', 'METER_RESET', 'REPLACEMENT', 'CORRECTION')),
  ADD CONSTRAINT meter_segments_on_behalf_ck CHECK (on_behalf_of IS NULL OR on_behalf_of <> entered_by);
ALTER TABLE app.reconciliations
  ADD CONSTRAINT reconciliations_state_ck CHECK (state IN ('DRAFT', 'READY', 'SUBMITTED', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED', 'POSTED', 'LOCKED'));
ALTER TABLE app.reconciliation_revisions
  ADD CONSTRAINT reconciliation_revisions_state_ck CHECK (state IN ('READY', 'SUBMITTED', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED', 'POSTED', 'LOCKED')),
  ADD CONSTRAINT reconciliation_revisions_classification_ck CHECK (variance_classification IN ('INFORMATIONAL', 'REQUIRES_EXPLANATION', 'BLOCKING')),
  ADD CONSTRAINT reconciliation_revisions_currency_ck CHECK (currency = 'USD');
ALTER TABLE app.payment_declarations
  ADD CONSTRAINT payment_declarations_category_ck CHECK (category IN ('CASH', 'ELECTRONIC', 'CUSTOMER_ACCOUNT', 'PREPAID', 'BENEFIT_INTERNAL', 'OTHER')),
  ADD CONSTRAINT payment_declarations_currency_ck CHECK (currency = 'USD');

ALTER TABLE app.meter_installations
  ADD CONSTRAINT meter_installations_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    nozzle_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );
ALTER TABLE app.meter_segments
  ADD CONSTRAINT meter_segments_nozzle_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    nozzle_id WITH =,
    tstzrange(segment_start_at, segment_end_at, '[)') WITH &&
  );
ALTER TABLE app.selling_prices
  ADD CONSTRAINT selling_prices_effective_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    station_id WITH =,
    product_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (state <> 'CANCELLED');

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'products', 'pumps', 'nozzles', 'meters', 'meter_installations',
    'station_business_days', 'shifts', 'selling_prices', 'meter_boundaries',
    'meter_segments', 'reconciliations', 'reconciliation_revisions',
    'payment_declarations'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())',
      table_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER SCHEMA app OWNER TO migration_owner;
    FOREACH table_name IN ARRAY ARRAY[
      'products', 'pumps', 'nozzles', 'meters', 'meter_installations',
      'station_business_days', 'shifts', 'selling_prices', 'meter_boundaries',
      'meter_segments', 'reconciliations', 'reconciliation_revisions',
      'payment_declarations'
    ] LOOP
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.products, app.pumps, app.nozzles,
      app.meters, app.meter_installations, app.station_business_days, app.shifts,
      app.selling_prices, app.meter_boundaries, app.meter_segments,
      app.reconciliations, app.reconciliation_revisions, app.payment_declarations
      TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.products, app.pumps, app.nozzles, app.meters,
      app.meter_installations, app.station_business_days, app.shifts,
      app.selling_prices, app.meter_boundaries, app.meter_segments,
      app.reconciliations, app.reconciliation_revisions, app.payment_declarations
      TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.products, app.pumps, app.nozzles, app.meters,
      app.meter_installations, app.station_business_days, app.shifts,
      app.selling_prices, app.meter_boundaries, app.meter_segments,
      app.reconciliations, app.reconciliation_revisions, app.payment_declarations
      TO diagnostics_readonly;
  END IF;
END
$$;
