CREATE TABLE "app"."fuel_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"delivery_note_number" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"note_quantity_litres" numeric(18, 3) NOT NULL,
	"actual_quantity_litres" numeric(18, 3) NOT NULL,
	"shortage_excess_litres" numeric(18, 3) NOT NULL,
	"supplier_reference" text,
	"transporter" text,
	"driver" text,
	"truck_registration" text,
	"seal_reference" text,
	"pre_delivery_dip_id" uuid,
	"post_delivery_dip_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"unit_landed_cost" numeric(20, 8),
	"total_landed_cost" numeric(20, 4),
	"currency" text,
	"recorded_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_deliveries_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "fuel_deliveries_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "fuel_deliveries_station_note_uidx" UNIQUE("tenant_id","station_id","delivery_note_number"),
	CONSTRAINT "fuel_deliveries_tenant_station_id_product_uidx" UNIQUE("tenant_id","station_id","id","product_id"),
	CONSTRAINT "fuel_deliveries_note_quantity_nonnegative_chk" CHECK ("app"."fuel_deliveries"."note_quantity_litres" >= 0),
	CONSTRAINT "fuel_deliveries_actual_quantity_nonnegative_chk" CHECK ("app"."fuel_deliveries"."actual_quantity_litres" >= 0),
	CONSTRAINT "fuel_deliveries_shortage_excess_consistent_chk" CHECK ("app"."fuel_deliveries"."shortage_excess_litres" = "app"."fuel_deliveries"."actual_quantity_litres" - "app"."fuel_deliveries"."note_quantity_litres"),
	CONSTRAINT "fuel_deliveries_status_chk" CHECK ("app"."fuel_deliveries"."status" in ('DRAFT', 'CONFIRMED', 'CANCELLED')),
	CONSTRAINT "fuel_deliveries_cost_pair_chk" CHECK (("app"."fuel_deliveries"."unit_landed_cost" is null and "app"."fuel_deliveries"."total_landed_cost" is null and "app"."fuel_deliveries"."currency" is null) or ("app"."fuel_deliveries"."unit_landed_cost" is not null and "app"."fuel_deliveries"."total_landed_cost" is not null and "app"."fuel_deliveries"."currency" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."fuel_delivery_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_litres" numeric(18, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_delivery_allocations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "fuel_delivery_allocations_delivery_tank_uidx" UNIQUE("tenant_id","delivery_id","tank_id"),
	CONSTRAINT "fuel_delivery_allocations_quantity_positive_chk" CHECK ("app"."fuel_delivery_allocations"."quantity_litres" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity_litres" numeric(18, 3) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"reason" text,
	"unit_landed_cost" numeric(20, 8),
	"total_landed_cost" numeric(20, 4),
	"currency" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_movements_source_uidx" UNIQUE("tenant_id","source_type","source_id","movement_type"),
	CONSTRAINT "inventory_movements_nonzero_quantity_chk" CHECK ("app"."inventory_movements"."quantity_litres" <> 0),
	CONSTRAINT "inventory_movements_cost_pair_chk" CHECK (("app"."inventory_movements"."unit_landed_cost" is null and "app"."inventory_movements"."total_landed_cost" is null and "app"."inventory_movements"."currency" is null) or ("app"."inventory_movements"."unit_landed_cost" is not null and "app"."inventory_movements"."total_landed_cost" is not null and "app"."inventory_movements"."currency" is not null)),
	CONSTRAINT "inventory_movements_reason_for_adjustment_chk" CHECK ("app"."inventory_movements"."movement_type" not in ('POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT') or btrim(coalesce("app"."inventory_movements"."reason", '')) <> '')
);
--> statement-breakpoint
CREATE TABLE "app"."tank_calibration_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"measurement_value" numeric(18, 3) NOT NULL,
	"measurement_unit" text NOT NULL,
	"litres" numeric(18, 3) NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tank_calibration_points_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "tank_calibration_points_tank_measurement_uidx" UNIQUE("tenant_id","tank_id","measurement_unit","measurement_value"),
	CONSTRAINT "tank_calibration_points_measurement_nonnegative_chk" CHECK ("app"."tank_calibration_points"."measurement_value" >= 0),
	CONSTRAINT "tank_calibration_points_litres_nonnegative_chk" CHECK ("app"."tank_calibration_points"."litres" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tank_dips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"physical_litres" numeric(18, 3) NOT NULL,
	"raw_measurement" numeric(18, 3),
	"measurement_unit" text,
	"recorded_by" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tank_dips_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "tank_dips_physical_nonnegative_chk" CHECK ("app"."tank_dips"."physical_litres" >= 0),
	CONSTRAINT "tank_dips_raw_measurement_pair_chk" CHECK (("app"."tank_dips"."raw_measurement" is null and "app"."tank_dips"."measurement_unit" is null) or ("app"."tank_dips"."raw_measurement" is not null and "app"."tank_dips"."measurement_unit" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."tank_dips" ADD CONSTRAINT "tank_dips_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id");--> statement-breakpoint
CREATE TABLE "app"."tanks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"capacity_litres" numeric(18, 3) NOT NULL,
	"reorder_level_litres" numeric(18, 3),
	"acceptable_variance_litres" numeric(18, 3),
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tanks_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "tanks_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "tanks_tenant_station_code_uidx" UNIQUE("tenant_id","station_id","code"),
	CONSTRAINT "tanks_tenant_station_id_product_uidx" UNIQUE("tenant_id","station_id","id","product_id"),
	CONSTRAINT "tanks_capacity_positive_chk" CHECK ("app"."tanks"."capacity_litres" > 0),
	CONSTRAINT "tanks_reorder_nonnegative_chk" CHECK ("app"."tanks"."reorder_level_litres" is null or "app"."tanks"."reorder_level_litres" >= 0),
	CONSTRAINT "tanks_variance_nonnegative_chk" CHECK ("app"."tanks"."acceptable_variance_litres" is null or "app"."tanks"."acceptable_variance_litres" >= 0),
	CONSTRAINT "tanks_status_chk" CHECK ("app"."tanks"."status" in ('ACTIVE', 'INACTIVE', 'RETIRED'))
);
--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_pre_dip_fk" FOREIGN KEY ("tenant_id","station_id","pre_delivery_dip_id") REFERENCES "app"."tank_dips"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_post_dip_fk" FOREIGN KEY ("tenant_id","station_id","post_delivery_dip_id") REFERENCES "app"."tank_dips"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_confirmed_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_allocations" ADD CONSTRAINT "fuel_delivery_allocations_delivery_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id") REFERENCES "app"."fuel_deliveries"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_allocations" ADD CONSTRAINT "fuel_delivery_allocations_tank_product_fk" FOREIGN KEY ("tenant_id","station_id","tank_id","product_id") REFERENCES "app"."tanks"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_allocations" ADD CONSTRAINT "fuel_delivery_allocations_delivery_product_fk" FOREIGN KEY ("tenant_id","station_id","delivery_id","product_id") REFERENCES "app"."fuel_deliveries"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_tank_product_fk" FOREIGN KEY ("tenant_id","station_id","tank_id","product_id") REFERENCES "app"."tanks"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tank_calibration_points" ADD CONSTRAINT "tank_calibration_points_tank_fk" FOREIGN KEY ("tenant_id","station_id","tank_id") REFERENCES "app"."tanks"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tank_calibration_points" ADD CONSTRAINT "tank_calibration_points_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tank_dips" ADD CONSTRAINT "tank_dips_tank_fk" FOREIGN KEY ("tenant_id","station_id","tank_id") REFERENCES "app"."tanks"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tank_dips" ADD CONSTRAINT "tank_dips_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tanks" ADD CONSTRAINT "tanks_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_deliveries_station_business_date_idx" ON "app"."fuel_deliveries" USING btree ("tenant_id","station_id","business_date");--> statement-breakpoint
CREATE INDEX "fuel_delivery_allocations_tank_idx" ON "app"."fuel_delivery_allocations" USING btree ("tenant_id","station_id","tank_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tank_effective_idx" ON "app"."inventory_movements" USING btree ("tenant_id","station_id","tank_id","effective_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_station_business_date_idx" ON "app"."inventory_movements" USING btree ("tenant_id","station_id","business_date");--> statement-breakpoint
CREATE INDEX "tank_calibration_points_tank_idx" ON "app"."tank_calibration_points" USING btree ("tenant_id","station_id","tank_id");--> statement-breakpoint
CREATE INDEX "tank_dips_tank_measured_idx" ON "app"."tank_dips" USING btree ("tenant_id","station_id","tank_id","measured_at");--> statement-breakpoint
CREATE INDEX "tank_dips_station_business_date_idx" ON "app"."tank_dips" USING btree ("tenant_id","station_id","business_date");--> statement-breakpoint
CREATE INDEX "tanks_tenant_station_product_status_idx" ON "app"."tanks" USING btree ("tenant_id","station_id","product_id","status");--> statement-breakpoint

ALTER TABLE app.inventory_movements
  ADD CONSTRAINT inventory_movements_type_sign_chk CHECK (
    (movement_type IN ('OPENING_BALANCE', 'DELIVERY', 'POSITIVE_ADJUSTMENT', 'TRANSFER_IN') AND quantity_litres > 0)
    OR (movement_type IN ('SALE', 'APPROVED_ISSUE', 'NEGATIVE_ADJUSTMENT', 'TRANSFER_OUT') AND quantity_litres < 0)
  );--> statement-breakpoint

CREATE UNIQUE INDEX inventory_movements_one_opening_balance_uidx
  ON app.inventory_movements (tenant_id, station_id, tank_id)
  WHERE movement_type = 'OPENING_BALANCE';--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_reject_immutable_inventory_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable after recording', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_validate_tank_dip_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tank_capacity numeric(18,3);
BEGIN
  SELECT capacity_litres INTO tank_capacity FROM app.tanks
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.tank_id FOR SHARE;
  IF tank_capacity IS NULL THEN RAISE EXCEPTION 'tank is not available in the requested station'; END IF;
  IF NEW.physical_litres > tank_capacity THEN RAISE EXCEPTION 'physical tank litres exceed tank capacity'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_validate_delivery_allocation_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delivery_actual numeric(18,3); allocated numeric(18,3);
BEGIN
  SELECT actual_quantity_litres INTO delivery_actual FROM app.fuel_deliveries
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.delivery_id FOR SHARE;
  SELECT COALESCE(SUM(quantity_litres), 0) INTO allocated FROM app.fuel_delivery_allocations
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND delivery_id = NEW.delivery_id;
  IF allocated > delivery_actual THEN RAISE EXCEPTION 'delivery allocations exceed actual received quantity'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_reject_confirmed_delivery_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delivery_status text; delivery_id uuid; tenant uuid; station uuid;
BEGIN
  tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  station := COALESCE(NEW.station_id, OLD.station_id);
  delivery_id := COALESCE(NEW.delivery_id, OLD.delivery_id);
  SELECT status INTO delivery_status FROM app.fuel_deliveries
  WHERE tenant_id = tenant AND station_id = station AND id = delivery_id;
  IF delivery_status IN ('CONFIRMED', 'CANCELLED') THEN RAISE EXCEPTION 'allocations cannot change after delivery confirmation or cancellation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_reject_posted_delivery_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('CONFIRMED', 'CANCELLED') THEN RAISE EXCEPTION 'confirmed or cancelled deliveries are immutable'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_prevent_negative_stock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance numeric(18,3);
BEGIN
  PERFORM 1 FROM app.tanks
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND id = NEW.tank_id FOR UPDATE;
  SELECT COALESCE(SUM(quantity_litres), 0) INTO balance FROM app.inventory_movements
  WHERE tenant_id = NEW.tenant_id AND station_id = NEW.station_id AND tank_id = NEW.tank_id;
  IF balance < 0 THEN RAISE EXCEPTION 'inventory movement would create negative stock'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a4_reject_tank_delete_with_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.tank_dips WHERE tenant_id = OLD.tenant_id AND station_id = OLD.station_id AND tank_id = OLD.id)
     OR EXISTS (SELECT 1 FROM app.fuel_delivery_allocations WHERE tenant_id = OLD.tenant_id AND station_id = OLD.station_id AND tank_id = OLD.id)
     OR EXISTS (SELECT 1 FROM app.inventory_movements WHERE tenant_id = OLD.tenant_id AND station_id = OLD.station_id AND tank_id = OLD.id) THEN
    RAISE EXCEPTION 'tanks with transaction history must be retired, not deleted';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tank_dips_capacity_guard BEFORE INSERT OR UPDATE ON app.tank_dips FOR EACH ROW EXECUTE FUNCTION app.a4_validate_tank_dip_capacity();--> statement-breakpoint
CREATE TRIGGER tank_dips_immutable_guard BEFORE UPDATE OR DELETE ON app.tank_dips FOR EACH ROW EXECUTE FUNCTION app.a4_reject_immutable_inventory_row();--> statement-breakpoint
CREATE TRIGGER fuel_delivery_allocations_status_guard BEFORE UPDATE OR DELETE ON app.fuel_delivery_allocations FOR EACH ROW EXECUTE FUNCTION app.a4_reject_confirmed_delivery_allocation();--> statement-breakpoint
CREATE TRIGGER fuel_delivery_allocations_total_guard AFTER INSERT OR UPDATE ON app.fuel_delivery_allocations FOR EACH ROW EXECUTE FUNCTION app.a4_validate_delivery_allocation_total();--> statement-breakpoint
CREATE TRIGGER fuel_deliveries_posted_guard BEFORE UPDATE ON app.fuel_deliveries FOR EACH ROW EXECUTE FUNCTION app.a4_reject_posted_delivery_change();--> statement-breakpoint
CREATE TRIGGER inventory_movements_negative_guard AFTER INSERT ON app.inventory_movements FOR EACH ROW EXECUTE FUNCTION app.a4_prevent_negative_stock();--> statement-breakpoint
CREATE TRIGGER inventory_movements_immutable_guard BEFORE UPDATE OR DELETE ON app.inventory_movements FOR EACH ROW EXECUTE FUNCTION app.a4_reject_immutable_inventory_row();--> statement-breakpoint
CREATE TRIGGER tanks_history_delete_guard BEFORE DELETE ON app.tanks FOR EACH ROW EXECUTE FUNCTION app.a4_reject_tank_delete_with_history();--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tanks', 'tank_calibration_points', 'tank_dips', 'fuel_deliveries', 'fuel_delivery_allocations', 'inventory_movements'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
  END LOOP;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER SCHEMA app OWNER TO migration_owner;
    ALTER TABLE app.tanks OWNER TO migration_owner;
    ALTER TABLE app.tank_calibration_points OWNER TO migration_owner;
    ALTER TABLE app.tank_dips OWNER TO migration_owner;
    ALTER TABLE app.fuel_deliveries OWNER TO migration_owner;
    ALTER TABLE app.fuel_delivery_allocations OWNER TO migration_owner;
    ALTER TABLE app.inventory_movements OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.tanks, app.fuel_deliveries TO app_runtime;
    GRANT SELECT, INSERT ON app.tank_calibration_points, app.tank_dips, app.fuel_delivery_allocations, app.inventory_movements TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.tanks, app.tank_calibration_points, app.tank_dips, app.fuel_deliveries, app.fuel_delivery_allocations, app.inventory_movements TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.tanks, app.tank_calibration_points, app.tank_dips, app.fuel_deliveries, app.fuel_delivery_allocations, app.inventory_movements TO diagnostics_readonly;
  END IF;
END
$$;--> statement-breakpoint

INSERT INTO platform.permission_definitions (code, description)
VALUES
  ('inventory.view', 'View station inventory positions and variance'),
  ('inventory.tank.manage', 'Create, retire, or deactivate station tanks'),
  ('inventory.dip.record', 'Record physical tank dips'),
  ('inventory.delivery.manage', 'Record and confirm fuel deliveries'),
  ('inventory.adjustment.post', 'Post controlled inventory opening balances and adjustments')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'inventory.view'), ('OWNER', 'inventory.tank.manage'), ('OWNER', 'inventory.dip.record'), ('OWNER', 'inventory.delivery.manage'), ('OWNER', 'inventory.adjustment.post'),
  ('ADMINISTRATOR', 'inventory.view'), ('ADMINISTRATOR', 'inventory.tank.manage'), ('ADMINISTRATOR', 'inventory.dip.record'), ('ADMINISTRATOR', 'inventory.delivery.manage'), ('ADMINISTRATOR', 'inventory.adjustment.post'),
  ('FINANCE', 'inventory.view'),
  ('SUPERVISOR', 'inventory.view'), ('SUPERVISOR', 'inventory.dip.record'), ('SUPERVISOR', 'inventory.delivery.manage')
ON CONFLICT DO NOTHING;
