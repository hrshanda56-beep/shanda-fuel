-- Fuel delivery detail: truck compartments, seals, water test, driver confirmation,
-- and the owner's "water test required before receipt" switch.
-- Additive only. Every table is tenant-scoped with RLS + FORCE RLS in the same style as
-- the delivery tables in 0004, and every row hangs off an existing delivery through the
-- (tenant_id, station_id, id) composite key so a row can never point at another tenant.

CREATE TABLE "app"."fuel_delivery_compartments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "compartment_number" integer NOT NULL,
  "product_id" uuid NOT NULL,
  "note_litres" numeric(18, 3) NOT NULL,
  "received_litres" numeric(18, 3) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fuel_delivery_compartments_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "fuel_delivery_compartments_delivery_number_uidx" UNIQUE ("tenant_id", "delivery_id", "compartment_number"),
  CONSTRAINT "fuel_delivery_compartments_number_chk" CHECK ("compartment_number" BETWEEN 1 AND 30),
  CONSTRAINT "fuel_delivery_compartments_note_nonnegative_chk" CHECK ("note_litres" >= 0),
  CONSTRAINT "fuel_delivery_compartments_received_nonnegative_chk" CHECK ("received_litres" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_compartments" ADD CONSTRAINT "fuel_delivery_compartments_delivery_fk"
  FOREIGN KEY ("tenant_id", "station_id", "delivery_id")
  REFERENCES "app"."fuel_deliveries"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_compartments" ADD CONSTRAINT "fuel_delivery_compartments_product_fk"
  FOREIGN KEY ("tenant_id", "product_id")
  REFERENCES "app"."products"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fuel_delivery_compartments_delivery_idx"
  ON "app"."fuel_delivery_compartments" USING btree ("tenant_id", "delivery_id");
--> statement-breakpoint

CREATE TABLE "app"."fuel_delivery_compartment_seals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "compartment_id" uuid NOT NULL,
  "seal_number" text NOT NULL,
  "intact" boolean NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fuel_delivery_compartment_seals_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "fuel_delivery_compartment_seals_number_uidx" UNIQUE ("tenant_id", "compartment_id", "seal_number"),
  CONSTRAINT "fuel_delivery_compartment_seals_number_chk" CHECK (length(btrim("seal_number")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_compartment_seals" ADD CONSTRAINT "fuel_delivery_compartment_seals_delivery_fk"
  FOREIGN KEY ("tenant_id", "station_id", "delivery_id")
  REFERENCES "app"."fuel_deliveries"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_compartment_seals" ADD CONSTRAINT "fuel_delivery_compartment_seals_compartment_fk"
  FOREIGN KEY ("tenant_id", "compartment_id")
  REFERENCES "app"."fuel_delivery_compartments"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "app"."fuel_delivery_water_tests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "result" text NOT NULL,
  "water_reading_mm" numeric(9, 2),
  "notes" text,
  "tested_at" timestamp with time zone NOT NULL,
  "recorded_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fuel_delivery_water_tests_one_per_delivery_uidx" UNIQUE ("tenant_id", "delivery_id"),
  CONSTRAINT "fuel_delivery_water_tests_result_chk" CHECK ("result" IN ('PASS', 'FAIL')),
  CONSTRAINT "fuel_delivery_water_tests_reading_chk" CHECK ("water_reading_mm" IS NULL OR "water_reading_mm" >= 0),
  CONSTRAINT "fuel_delivery_water_tests_notes_chk" CHECK ("notes" IS NULL OR length("notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_water_tests" ADD CONSTRAINT "fuel_delivery_water_tests_delivery_fk"
  FOREIGN KEY ("tenant_id", "station_id", "delivery_id")
  REFERENCES "app"."fuel_deliveries"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_water_tests" ADD CONSTRAINT "fuel_delivery_water_tests_recorded_by_fk"
  FOREIGN KEY ("tenant_id", "recorded_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "app"."fuel_delivery_driver_confirmations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "delivery_id" uuid NOT NULL,
  "driver_name" text NOT NULL,
  "confirmed" boolean NOT NULL,
  "confirmed_at" timestamp with time zone,
  "notes" text,
  "recorded_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fuel_delivery_driver_confirmations_one_per_delivery_uidx" UNIQUE ("tenant_id", "delivery_id"),
  CONSTRAINT "fuel_delivery_driver_confirmations_name_chk" CHECK (length(btrim("driver_name")) BETWEEN 1 AND 120),
  CONSTRAINT "fuel_delivery_driver_confirmations_time_chk" CHECK (("confirmed" AND "confirmed_at" IS NOT NULL) OR (NOT "confirmed")),
  CONSTRAINT "fuel_delivery_driver_confirmations_notes_chk" CHECK ("notes" IS NULL OR length("notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_driver_confirmations" ADD CONSTRAINT "fuel_delivery_driver_confirmations_delivery_fk"
  FOREIGN KEY ("tenant_id", "station_id", "delivery_id")
  REFERENCES "app"."fuel_deliveries"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_driver_confirmations" ADD CONSTRAINT "fuel_delivery_driver_confirmations_recorded_by_fk"
  FOREIGN KEY ("tenant_id", "recorded_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Owner switch. Default false: the water test is recorded but never blocks a receipt.
CREATE TABLE "app"."delivery_settings" (
  "tenant_id" uuid PRIMARY KEY NOT NULL,
  "water_test_required" boolean DEFAULT false NOT NULL,
  "updated_by" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_settings" ADD CONSTRAINT "delivery_settings_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."delivery_settings" ADD CONSTRAINT "delivery_settings_updated_by_fk"
  FOREIGN KEY ("tenant_id", "updated_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Detail is editable only while its delivery is a draft. Water test and driver
-- confirmation changes are also refused on a cancelled delivery; the driver may still
-- confirm after the delivery was received.
CREATE OR REPLACE FUNCTION app.delivery_detail_status_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
DECLARE
  delivery_status text;
  target_tenant uuid;
  target_station uuid;
  target_delivery uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tenant := OLD.tenant_id; target_station := OLD.station_id; target_delivery := OLD.delivery_id;
  ELSE
    target_tenant := NEW.tenant_id; target_station := NEW.station_id; target_delivery := NEW.delivery_id;
  END IF;
  SELECT status INTO delivery_status FROM app.fuel_deliveries
  WHERE tenant_id = target_tenant AND station_id = target_station AND id = target_delivery;
  IF delivery_status IS NULL THEN
    RAISE EXCEPTION 'delivery not found for delivery detail';
  END IF;
  IF TG_TABLE_NAME = 'fuel_delivery_driver_confirmations' THEN
    IF delivery_status = 'CANCELLED' THEN
      RAISE EXCEPTION 'cancelled deliveries cannot be changed';
    END IF;
  ELSIF delivery_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'delivery detail can only change while the delivery is a draft';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER fuel_delivery_compartments_status_guard BEFORE INSERT OR UPDATE OR DELETE ON app.fuel_delivery_compartments FOR EACH ROW EXECUTE FUNCTION app.delivery_detail_status_guard();
--> statement-breakpoint
CREATE TRIGGER fuel_delivery_compartment_seals_status_guard BEFORE INSERT OR UPDATE OR DELETE ON app.fuel_delivery_compartment_seals FOR EACH ROW EXECUTE FUNCTION app.delivery_detail_status_guard();
--> statement-breakpoint
CREATE TRIGGER fuel_delivery_water_tests_status_guard BEFORE INSERT OR UPDATE OR DELETE ON app.fuel_delivery_water_tests FOR EACH ROW EXECUTE FUNCTION app.delivery_detail_status_guard();
--> statement-breakpoint
CREATE TRIGGER fuel_delivery_driver_confirmations_status_guard BEFORE INSERT OR UPDATE OR DELETE ON app.fuel_delivery_driver_confirmations FOR EACH ROW EXECUTE FUNCTION app.delivery_detail_status_guard();
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['fuel_delivery_compartments', 'fuel_delivery_compartment_seals', 'fuel_delivery_water_tests', 'fuel_delivery_driver_confirmations', 'delivery_settings'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
  END LOOP;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.fuel_delivery_compartments OWNER TO migration_owner;
    ALTER TABLE app.fuel_delivery_compartment_seals OWNER TO migration_owner;
    ALTER TABLE app.fuel_delivery_water_tests OWNER TO migration_owner;
    ALTER TABLE app.fuel_delivery_driver_confirmations OWNER TO migration_owner;
    ALTER TABLE app.delivery_settings OWNER TO migration_owner;
    ALTER FUNCTION app.delivery_detail_status_guard() OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- Compartments and seals are rewritten as a set while the delivery is a draft.
    GRANT SELECT, INSERT, DELETE ON app.fuel_delivery_compartments, app.fuel_delivery_compartment_seals TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.fuel_delivery_water_tests, app.fuel_delivery_driver_confirmations, app.delivery_settings TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.fuel_delivery_compartments, app.fuel_delivery_compartment_seals, app.fuel_delivery_water_tests, app.fuel_delivery_driver_confirmations, app.delivery_settings TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.fuel_delivery_compartments, app.fuel_delivery_compartment_seals, app.fuel_delivery_water_tests, app.fuel_delivery_driver_confirmations, app.delivery_settings TO diagnostics_readonly;
  END IF;
END
$$;
