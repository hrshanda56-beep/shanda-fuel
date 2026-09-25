CREATE TABLE "app"."inventory_cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_cost_events_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_cost_events_source_uidx" UNIQUE("tenant_id","source_type","source_id","event_type"),
	CONSTRAINT "inventory_cost_events_type_ck" CHECK ("app"."inventory_cost_events"."event_type" in ('OPENING_COST','RECEIPT_COST','SALE_COGS','COGS_REVALUATION','INVENTORY_REVALUATION','ADJUSTMENT_COST')),
	CONSTRAINT "inventory_cost_events_sale_cogs_negative_ck" CHECK ("app"."inventory_cost_events"."event_type" <> 'SALE_COGS' or "app"."inventory_cost_events"."amount" < 0),
	CONSTRAINT "inventory_cost_events_amount_nonzero_ck" CHECK ("app"."inventory_cost_events"."amount" <> 0),
	CONSTRAINT "inventory_cost_events_currency_nonempty_ck" CHECK (btrim("app"."inventory_cost_events"."currency") <> '')
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_cost_revaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"restatement_from_at" timestamp with time zone,
	"restatement_through_at" timestamp with time zone,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_cost_revaluations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_cost_revaluations_status_ck" CHECK ("app"."inventory_cost_revaluations"."status" in ('REQUESTED','APPROVED','REJECTED','CANCELLED','POSTED')),
	CONSTRAINT "inventory_cost_revaluations_reason_nonempty_ck" CHECK (btrim("app"."inventory_cost_revaluations"."reason") <> ''),
	CONSTRAINT "inventory_cost_revaluations_boundary_order_ck" CHECK ("app"."inventory_cost_revaluations"."restatement_through_at" is null or "app"."inventory_cost_revaluations"."restatement_from_at" is null or "app"."inventory_cost_revaluations"."restatement_through_at" >= "app"."inventory_cost_revaluations"."restatement_from_at")
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_cost_stream_state" (
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_litres" numeric(18, 3) DEFAULT '0' NOT NULL,
	"inventory_value" numeric(20, 4),
	"weighted_average_cost" numeric(20, 8),
	"currency" text,
	"valuation_status" text DEFAULT 'UNVALUED' NOT NULL,
	"last_movement_effective_at" timestamp with time zone,
	"last_movement_id" uuid,
	"last_cost_event_effective_at" timestamp with time zone,
	"last_cost_event_id" uuid,
	"projection_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_cost_stream_state_pk" PRIMARY KEY("tenant_id","station_id","tank_id","product_id"),
	CONSTRAINT "inventory_cost_stream_state_quantity_nonnegative_ck" CHECK ("app"."inventory_cost_stream_state"."quantity_litres" >= 0),
	CONSTRAINT "inventory_cost_stream_state_status_ck" CHECK ("app"."inventory_cost_stream_state"."valuation_status" in ('VALUED','UNVALUED')),
	CONSTRAINT "inventory_cost_stream_state_valuation_pair_ck" CHECK (("app"."inventory_cost_stream_state"."valuation_status" = 'UNVALUED' and "app"."inventory_cost_stream_state"."inventory_value" is null and "app"."inventory_cost_stream_state"."weighted_average_cost" is null and "app"."inventory_cost_stream_state"."currency" is null) or ("app"."inventory_cost_stream_state"."valuation_status" = 'VALUED' and "app"."inventory_cost_stream_state"."inventory_value" is not null and "app"."inventory_cost_stream_state"."currency" is not null and btrim("app"."inventory_cost_stream_state"."currency") <> '' and ("app"."inventory_cost_stream_state"."quantity_litres" = 0 or "app"."inventory_cost_stream_state"."weighted_average_cost" is not null)))
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_sale_cost_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"tank_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	"meter_segment_id" uuid NOT NULL,
	"sale_quantity_litres" numeric(18, 3) NOT NULL,
	"pre_sale_wac" numeric(20, 8),
	"original_cogs" numeric(20, 4),
	"valuation_status" text NOT NULL,
	"valuation_basis" text NOT NULL,
	"replay_fingerprint" text NOT NULL,
	"sale_cost_event_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_sale_cost_attributions_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "inventory_sale_cost_attributions_segment_uidx" UNIQUE("tenant_id","station_id","meter_segment_id"),
	CONSTRAINT "inventory_sale_cost_attributions_movement_uidx" UNIQUE("tenant_id","station_id","inventory_movement_id"),
	CONSTRAINT "inventory_sale_cost_attributions_quantity_positive_ck" CHECK ("app"."inventory_sale_cost_attributions"."sale_quantity_litres" > 0),
	CONSTRAINT "inventory_sale_cost_attributions_status_ck" CHECK ("app"."inventory_sale_cost_attributions"."valuation_status" = 'VALUED'),
	CONSTRAINT "inventory_sale_cost_attributions_basis_ck" CHECK ("app"."inventory_sale_cost_attributions"."valuation_basis" = 'PRE_SALE_WAC' and "app"."inventory_sale_cost_attributions"."pre_sale_wac" is not null and "app"."inventory_sale_cost_attributions"."original_cogs" is not null and "app"."inventory_sale_cost_attributions"."sale_cost_event_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_events" ADD CONSTRAINT "inventory_cost_events_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_events" ADD CONSTRAINT "inventory_cost_events_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_events" ADD CONSTRAINT "inventory_cost_events_tank_product_fk" FOREIGN KEY ("tenant_id","station_id","tank_id","product_id") REFERENCES "app"."tanks"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_events" ADD CONSTRAINT "inventory_cost_events_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_events" ADD CONSTRAINT "inventory_cost_events_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_revaluations" ADD CONSTRAINT "inventory_cost_revaluations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_revaluations" ADD CONSTRAINT "inventory_cost_revaluations_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_revaluations" ADD CONSTRAINT "inventory_cost_revaluations_tank_product_fk" FOREIGN KEY ("tenant_id","station_id","tank_id","product_id") REFERENCES "app"."tanks"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_revaluations" ADD CONSTRAINT "inventory_cost_revaluations_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_revaluations" ADD CONSTRAINT "inventory_cost_revaluations_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_revaluations" ADD CONSTRAINT "inventory_cost_revaluations_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_stream_state" ADD CONSTRAINT "inventory_cost_stream_state_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_stream_state" ADD CONSTRAINT "inventory_cost_stream_state_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_stream_state" ADD CONSTRAINT "inventory_cost_stream_state_tank_product_fk" FOREIGN KEY ("tenant_id","station_id","tank_id","product_id") REFERENCES "app"."tanks"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_stream_state" ADD CONSTRAINT "inventory_cost_stream_state_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_stream_state" ADD CONSTRAINT "inventory_cost_stream_state_last_movement_fk" FOREIGN KEY ("tenant_id","last_movement_id") REFERENCES "app"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_cost_stream_state" ADD CONSTRAINT "inventory_cost_stream_state_last_cost_event_fk" FOREIGN KEY ("tenant_id","last_cost_event_id") REFERENCES "app"."inventory_cost_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_sale_cost_attributions" ADD CONSTRAINT "inventory_sale_cost_attributions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_sale_cost_attributions" ADD CONSTRAINT "inventory_sale_cost_attributions_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_sale_cost_attributions" ADD CONSTRAINT "inventory_sale_cost_attributions_tank_product_fk" FOREIGN KEY ("tenant_id","station_id","tank_id","product_id") REFERENCES "app"."tanks"("tenant_id","station_id","id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_sale_cost_attributions" ADD CONSTRAINT "inventory_sale_cost_attributions_movement_fk" FOREIGN KEY ("tenant_id","inventory_movement_id") REFERENCES "app"."inventory_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_sale_cost_attributions" ADD CONSTRAINT "inventory_sale_cost_attributions_meter_segment_fk" FOREIGN KEY ("tenant_id","station_id","meter_segment_id") REFERENCES "app"."meter_segments"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_sale_cost_attributions" ADD CONSTRAINT "inventory_sale_cost_attributions_cost_event_fk" FOREIGN KEY ("tenant_id","sale_cost_event_id") REFERENCES "app"."inventory_cost_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_cost_events_stream_effective_idx" ON "app"."inventory_cost_events" USING btree ("tenant_id","station_id","tank_id","product_id","effective_at","id");--> statement-breakpoint
CREATE INDEX "inventory_cost_revaluations_stream_idx" ON "app"."inventory_cost_revaluations" USING btree ("tenant_id","station_id","tank_id","product_id","effective_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_station_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('app.station_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN current_setting('app.station_id', true)::uuid
    ELSE NULL
  END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_reject_cost_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory cost events are append-only; use a named revaluation or adjustment';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_cost_events_append_only
BEFORE UPDATE OR DELETE ON app.inventory_cost_events
FOR EACH ROW EXECUTE FUNCTION app.a12_reject_cost_event_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_reject_sale_attribution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory sale cost attributions are immutable; use a named revaluation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_sale_cost_attributions_append_only
BEFORE UPDATE OR DELETE ON app.inventory_sale_cost_attributions
FOR EACH ROW EXECUTE FUNCTION app.a12_reject_sale_attribution_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_validate_sale_cost_attribution()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  movement record;
  segment record;
  cost_event record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'inventory sale cost attributions are append-only';
  END IF;

  SELECT movement_type, quantity_litres, source_type, source_id, tank_id, product_id,
         effective_at, business_date
    INTO movement
    FROM app.inventory_movements
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.inventory_movement_id
   FOR SHARE;
  IF NOT FOUND OR movement.source_type <> 'METER_SEGMENT_SALE'
     OR movement.movement_type <> 'SALE'
     OR movement.source_id <> NEW.meter_segment_id
     OR movement.tank_id <> NEW.tank_id
     OR movement.product_id <> NEW.product_id
     OR movement.quantity_litres >= 0
     OR NEW.sale_quantity_litres IS DISTINCT FROM -movement.quantity_litres
     OR NEW.effective_at IS DISTINCT FROM movement.effective_at
     OR NEW.business_date IS DISTINCT FROM movement.business_date THEN
    RAISE EXCEPTION 'sale cost attribution must match the canonical METER_SEGMENT_SALE movement';
  END IF;

  SELECT product_id, litres, state
    INTO segment
    FROM app.meter_segments
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND id = NEW.meter_segment_id
   FOR SHARE;
  IF NOT FOUND OR segment.state <> 'SEALED'
     OR segment.product_id <> NEW.product_id
     OR segment.litres IS DISTINCT FROM NEW.sale_quantity_litres THEN
    RAISE EXCEPTION 'sale cost attribution must match a sealed meter segment';
  END IF;

  IF NEW.valuation_status = 'VALUED' THEN
    SELECT event_type, source_type, source_id, station_id, tank_id, product_id,
           effective_at, business_date, amount
      INTO cost_event
      FROM app.inventory_cost_events
     WHERE tenant_id = NEW.tenant_id
       AND id = NEW.sale_cost_event_id
     FOR SHARE;
    IF NOT FOUND OR cost_event.event_type <> 'SALE_COGS'
       OR cost_event.source_type <> 'METER_SEGMENT_SALE'
       OR cost_event.source_id <> NEW.meter_segment_id
       OR cost_event.station_id <> NEW.station_id
       OR cost_event.tank_id <> NEW.tank_id
       OR cost_event.product_id <> NEW.product_id
       OR cost_event.effective_at IS DISTINCT FROM NEW.effective_at
       OR cost_event.business_date IS DISTINCT FROM NEW.business_date
       OR cost_event.amount IS DISTINCT FROM -NEW.original_cogs THEN
      RAISE EXCEPTION 'valued sale attribution must reference its signed SALE_COGS event';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_sale_cost_attributions_context_guard
BEFORE INSERT ON app.inventory_sale_cost_attributions
FOR EACH ROW EXECUTE FUNCTION app.a12_validate_sale_cost_attribution();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_revaluation_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory cost revaluations are immutable; use explicit workflow transitions';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'inventory cost revaluations must be created in REQUESTED state';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.station_id IS DISTINCT FROM OLD.station_id
     OR NEW.tank_id IS DISTINCT FROM OLD.tank_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.restatement_from_at IS DISTINCT FROM OLD.restatement_from_at
     OR NEW.restatement_through_at IS DISTINCT FROM OLD.restatement_through_at
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'inventory cost revaluation metadata is immutable';
  END IF;
  IF NOT ((OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED'))
       OR (OLD.status = 'APPROVED' AND NEW.status IN ('POSTED','CANCELLED'))) THEN
    RAISE EXCEPTION 'invalid inventory cost revaluation transition';
  END IF;
  IF NEW.status = 'APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'approved inventory cost revaluations require approval provenance';
  END IF;
  IF NEW.status <> 'APPROVED' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'approval provenance can only be set during approval';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_cost_revaluations_transition_guard
BEFORE INSERT OR UPDATE OR DELETE ON app.inventory_cost_revaluations
FOR EACH ROW EXECUTE FUNCTION app.a12_revaluation_transition_guard();
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventory_cost_events', 'inventory_cost_stream_state',
    'inventory_sale_cost_attributions', 'inventory_cost_revaluations'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership() AND (app.current_station_id() IS NULL OR station_id = app.current_station_id())) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership() AND (app.current_station_id() IS NULL OR station_id = app.current_station_id()))',
      table_name || '_tenant_station_context', table_name
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.inventory_cost_events TO app_runtime;
    GRANT SELECT ON app.inventory_cost_stream_state TO app_runtime;
    GRANT SELECT, INSERT ON app.inventory_sale_cost_attributions TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.inventory_cost_revaluations TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.inventory_cost_events, app.inventory_sale_cost_attributions, app.inventory_cost_revaluations TO job_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON app.inventory_cost_stream_state TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.inventory_cost_events, app.inventory_cost_stream_state, app.inventory_sale_cost_attributions, app.inventory_cost_revaluations TO diagnostics_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.current_station_id() OWNER TO migration_owner;
    ALTER FUNCTION app.a12_reject_cost_event_mutation() OWNER TO migration_owner;
    ALTER FUNCTION app.a12_reject_sale_attribution_mutation() OWNER TO migration_owner;
    ALTER FUNCTION app.a12_validate_sale_cost_attribution() OWNER TO migration_owner;
    ALTER FUNCTION app.a12_revaluation_transition_guard() OWNER TO migration_owner;
  END IF;
END
$$;
--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON app.inventory_cost_events, app.inventory_sale_cost_attributions FROM app_runtime;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON app.inventory_cost_revaluations FROM app_runtime;
REVOKE ALL ON app.inventory_cost_stream_state FROM app_runtime;
GRANT SELECT ON app.inventory_cost_stream_state TO app_runtime;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.current_station_id() TO app_runtime, job_runtime, diagnostics_readonly;
