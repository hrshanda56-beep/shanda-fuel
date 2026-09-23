CREATE TABLE "app"."reconciliation_attendants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"attendant_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_attendants_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_attendants_member_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","attendant_id")
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_cash_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"counted_cash" numeric(20, 4) NOT NULL,
	"expected_physical_cash" numeric(20, 4) NOT NULL,
	"cash_paid_expenses" numeric(20, 4) NOT NULL,
	"net_expected_cash" numeric(20, 4) NOT NULL,
	"cash_variance" numeric(20, 4) NOT NULL,
	"explanation" text,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_cash_declarations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_cash_declarations_reconciliation_uidx" UNIQUE("tenant_id","station_id","reconciliation_id"),
	CONSTRAINT "reconciliation_cash_declarations_nonnegative_ck" CHECK ("app"."reconciliation_cash_declarations"."counted_cash" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_delivery_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"allocation_id" uuid,
	"product_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_delivery_refs_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_delivery_refs_delivery_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","delivery_id","allocation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_dip_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"dip_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_dip_refs_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_dip_refs_dip_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","dip_id")
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"payment_method" text NOT NULL,
	"person_paid" text,
	"reference" text,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_expenses_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_expenses_amount_ck" CHECK ("app"."reconciliation_expenses"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"nozzle_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"opening_reading" numeric(18, 3) NOT NULL,
	"closing_reading" numeric(18, 3) NOT NULL,
	"litres_sold" numeric(18, 3) NOT NULL,
	"selling_price_id" uuid,
	"unit_price" numeric(20, 6) NOT NULL,
	"sales_value" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_meter_readings_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_meter_readings_nozzle_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","nozzle_id"),
	CONSTRAINT "reconciliation_meter_readings_nonnegative_litres_ck" CHECK ("app"."reconciliation_meter_readings"."litres_sold" >= 0),
	CONSTRAINT "reconciliation_meter_readings_arithmetic_ck" CHECK ("app"."reconciliation_meter_readings"."litres_sold" = "app"."reconciliation_meter_readings"."closing_reading" - "app"."reconciliation_meter_readings"."opening_reading"),
	CONSTRAINT "reconciliation_meter_readings_sales_value_ck" CHECK ("app"."reconciliation_meter_readings"."sales_value" = round("app"."reconciliation_meter_readings"."litres_sold" * "app"."reconciliation_meter_readings"."unit_price", 4)),
	CONSTRAINT "reconciliation_meter_readings_currency_ck" CHECK ("app"."reconciliation_meter_readings"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"reference" text,
	"note" text,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_payments_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_payments_amount_ck" CHECK ("app"."reconciliation_payments"."amount" >= 0),
	CONSTRAINT "reconciliation_payments_method_ck" CHECK ("app"."reconciliation_payments"."method" in ('CASH','POS','ECOCASH','BANK_TRANSFER','CUSTOMER_CREDIT','PREPAID','STAFF_OR_MANAGEMENT_FUEL','OTHER_APPROVED'))
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_variance_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"category" text NOT NULL,
	"explanation" text NOT NULL,
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_variance_explanations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_variance_explanations_category_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","category"),
	CONSTRAINT "reconciliation_variance_explanations_category_ck" CHECK ("app"."reconciliation_variance_explanations"."category" in ('SALES','CASH','STOCK'))
);
--> statement-breakpoint
ALTER TABLE "app"."reconciliations" DROP CONSTRAINT "reconciliations_business_day_uidx";--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "returned_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_attendants" ADD CONSTRAINT "reconciliation_attendants_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_attendants" ADD CONSTRAINT "reconciliation_attendants_attendant_fk" FOREIGN KEY ("tenant_id","attendant_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_attendants" ADD CONSTRAINT "reconciliation_attendants_assigned_by_fk" FOREIGN KEY ("tenant_id","assigned_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_cash_declarations" ADD CONSTRAINT "reconciliation_cash_declarations_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_cash_declarations" ADD CONSTRAINT "reconciliation_cash_declarations_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_delivery_refs" ADD CONSTRAINT "reconciliation_delivery_refs_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_delivery_refs" ADD CONSTRAINT "reconciliation_delivery_refs_delivery_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id") REFERENCES "app"."fuel_deliveries"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_delivery_refs" ADD CONSTRAINT "reconciliation_delivery_refs_tank_fk" FOREIGN KEY ("tenant_id","station_id","tank_id") REFERENCES "app"."tanks"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_delivery_refs" ADD CONSTRAINT "reconciliation_delivery_refs_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_delivery_refs" ADD CONSTRAINT "reconciliation_delivery_refs_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_dip_refs" ADD CONSTRAINT "reconciliation_dip_refs_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_dip_refs" ADD CONSTRAINT "reconciliation_dip_refs_dip_fk" FOREIGN KEY ("tenant_id","station_id","dip_id") REFERENCES "app"."tank_dips"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_dip_refs" ADD CONSTRAINT "reconciliation_dip_refs_tank_fk" FOREIGN KEY ("tenant_id","station_id","tank_id") REFERENCES "app"."tanks"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_dip_refs" ADD CONSTRAINT "reconciliation_dip_refs_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_dip_refs" ADD CONSTRAINT "reconciliation_dip_refs_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_expenses" ADD CONSTRAINT "reconciliation_expenses_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_expenses" ADD CONSTRAINT "reconciliation_expenses_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_shift_fk" FOREIGN KEY ("tenant_id","station_id","shift_id") REFERENCES "app"."shifts"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_nozzle_fk" FOREIGN KEY ("tenant_id","station_id","nozzle_id") REFERENCES "app"."nozzles"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_price_fk" FOREIGN KEY ("tenant_id","station_id","selling_price_id") REFERENCES "app"."selling_prices"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_payments" ADD CONSTRAINT "reconciliation_payments_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_payments" ADD CONSTRAINT "reconciliation_payments_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_variance_explanations" ADD CONSTRAINT "reconciliation_variance_explanations_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_variance_explanations" ADD CONSTRAINT "reconciliation_variance_explanations_entered_by_fk" FOREIGN KEY ("tenant_id","entered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_shift_fk" FOREIGN KEY ("tenant_id","station_id","shift_id") REFERENCES "app"."shifts"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_supervisor_fk" FOREIGN KEY ("tenant_id","supervisor_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_returned_by_fk" FOREIGN KEY ("tenant_id","returned_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_shift_uidx" UNIQUE("tenant_id","station_id","shift_id");

-- PR #8 production detail rows are editable only while their parent is DRAFT or
-- RETURNED.  Once submitted, the parent and all supporting evidence become
-- authoritative history; corrections use the existing returned-revision flow.
CREATE OR REPLACE FUNCTION app.a5_reconciliation_detail_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reconciliation_state text;
BEGIN
  SELECT state INTO reconciliation_state
  FROM app.reconciliations
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND station_id = COALESCE(NEW.station_id, OLD.station_id)
    AND id = COALESCE(NEW.reconciliation_id, OLD.reconciliation_id)
  FOR UPDATE;
  IF reconciliation_state IS NULL THEN
    RAISE EXCEPTION 'reconciliation detail requires a valid reconciliation';
  END IF;
  IF reconciliation_state NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'reconciliation detail is locked after submission';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'reconciliation_attendants',
    'reconciliation_meter_readings',
    'reconciliation_payments',
    'reconciliation_expenses',
    'reconciliation_delivery_refs',
    'reconciliation_dip_refs',
    'reconciliation_cash_declarations',
    'reconciliation_variance_explanations'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.a5_reconciliation_detail_guard()', table_name || '_state_guard', table_name);
  END LOOP;
END
$$;

-- Preserve the earlier A3 transitions while permitting the normalized shift-
-- scoped DRAFT/SUBMITTED/RETURNED/APPROVED flow used by the real adapters.
CREATE OR REPLACE FUNCTION app.enforce_forecourt_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'shifts' AND NEW.state = 'NOT_OPERATED'
     AND (to_jsonb(NEW)->>'not_operated_reason' IS NULL OR btrim(to_jsonb(NEW)->>'not_operated_reason') = '') THEN
    RAISE EXCEPTION 'NOT_OPERATED shifts require a reason';
  END IF;
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
    allowed := (OLD.state, NEW.state) IN (
      ('DRAFT','READY'), ('DRAFT','SUBMITTED'), ('READY','SUBMITTED'),
      ('SUBMITTED','PENDING_APPROVAL'), ('SUBMITTED','RETURNED'), ('SUBMITTED','APPROVED'),
      ('PENDING_APPROVAL','RETURNED'), ('PENDING_APPROVAL','REJECTED'), ('PENDING_APPROVAL','APPROVED'),
      ('RETURNED','SUBMITTED'), ('APPROVED','POSTED'), ('POSTED','LOCKED')
    );
  ELSIF TG_TABLE_NAME = 'selling_prices' THEN
    allowed := (OLD.state, NEW.state) IN (('DRAFT','PENDING_APPROVAL'),('PENDING_APPROVAL','APPROVED'),('PENDING_APPROVAL','CANCELLED'),('APPROVED','SCHEDULED'),('APPROVED','PENDING_STATION_ACTIVATION'),('APPROVED','CANCELLED'),('SCHEDULED','PENDING_STATION_ACTIVATION'),('SCHEDULED','CANCELLED'),('PENDING_STATION_ACTIVATION','BOUNDARIES_IN_PROGRESS'),('PENDING_STATION_ACTIVATION','FAILED_ACTIVATION'),('BOUNDARIES_IN_PROGRESS','ACTIVE'),('BOUNDARIES_IN_PROGRESS','FAILED_ACTIVATION'),('FAILED_ACTIVATION','PENDING_STATION_ACTIVATION'),('FAILED_ACTIVATION','CANCELLED'));
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'forbidden direct forecourt workflow transition: % -> % on %', OLD.state, NEW.state, TG_TABLE_NAME; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.a5_reconciliation_header_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('SUBMITTED','RETURNED','APPROVED','POSTED','LOCKED') THEN
      RAISE EXCEPTION 'submitted reconciliations are immutable; use a named workflow command';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state IN ('APPROVED','POSTED','LOCKED') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id
    OR NEW.business_day_id IS DISTINCT FROM OLD.business_day_id OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id
    OR (NEW.state IS DISTINCT FROM OLD.state AND NOT (
      (OLD.state = 'APPROVED' AND NEW.state = 'POSTED')
      OR (OLD.state = 'POSTED' AND NEW.state = 'LOCKED')
    ))
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.returned_by IS DISTINCT FROM OLD.returned_by
    OR NEW.returned_at IS DISTINCT FROM OLD.returned_at OR NEW.return_reason IS DISTINCT FROM OLD.return_reason
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'approved reconciliation headers are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reconciliation_a5_header_guard ON app.reconciliations;
CREATE TRIGGER reconciliation_a5_header_guard BEFORE UPDATE OR DELETE ON app.reconciliations FOR EACH ROW EXECUTE FUNCTION app.a5_reconciliation_header_guard();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'reconciliation_attendants', 'reconciliation_meter_readings',
    'reconciliation_payments', 'reconciliation_expenses',
    'reconciliation_delivery_refs', 'reconciliation_dip_refs',
    'reconciliation_cash_declarations', 'reconciliation_variance_explanations'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.reconciliation_attendants, app.reconciliation_meter_readings, app.reconciliation_payments, app.reconciliation_expenses, app.reconciliation_delivery_refs, app.reconciliation_dip_refs, app.reconciliation_cash_declarations, app.reconciliation_variance_explanations TO app_runtime;
    GRANT UPDATE ON app.reconciliations TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.reconciliation_attendants, app.reconciliation_meter_readings, app.reconciliation_payments, app.reconciliation_expenses, app.reconciliation_delivery_refs, app.reconciliation_dip_refs, app.reconciliation_cash_declarations, app.reconciliation_variance_explanations TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
GRANT SELECT ON app.reconciliation_attendants, app.reconciliation_meter_readings, app.reconciliation_payments, app.reconciliation_expenses, app.reconciliation_delivery_refs, app.reconciliation_dip_refs, app.reconciliation_cash_declarations, app.reconciliation_variance_explanations TO diagnostics_readonly;
  END IF;
END
$$;

-- A5 production reconciliation is operated by station supervisors and approved
-- by management.  A3 defined the permissions but did not attach them to the
-- roles, so the canonical A5 migration closes that authorization gap.
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'reconciliation.view'),
  ('OWNER', 'reconciliation.return'),
  ('OWNER', 'reconciliation.approve'),
  ('SUPERVISOR', 'reconciliation.view'),
  ('SUPERVISOR', 'reconciliation.submit'),
  ('ADMINISTRATOR', 'reconciliation.view'),
  ('ADMINISTRATOR', 'reconciliation.return'),
  ('ADMINISTRATOR', 'reconciliation.approve')
ON CONFLICT DO NOTHING;

CREATE INDEX reconciliation_meter_readings_lookup_idx ON app.reconciliation_meter_readings (tenant_id, station_id, reconciliation_id);
CREATE INDEX reconciliation_payments_lookup_idx ON app.reconciliation_payments (tenant_id, station_id, reconciliation_id);
CREATE INDEX reconciliation_expenses_lookup_idx ON app.reconciliation_expenses (tenant_id, station_id, reconciliation_id);
CREATE INDEX reconciliation_delivery_refs_lookup_idx ON app.reconciliation_delivery_refs (tenant_id, station_id, reconciliation_id);
CREATE INDEX reconciliation_dip_refs_lookup_idx ON app.reconciliation_dip_refs (tenant_id, station_id, reconciliation_id);
