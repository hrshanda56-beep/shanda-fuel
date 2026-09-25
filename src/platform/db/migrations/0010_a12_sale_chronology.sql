CREATE TABLE "app"."reconciliation_meter_reading_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"reconciliation_meter_reading_id" uuid NOT NULL,
	"meter_segment_id" uuid NOT NULL,
	"allocated_litres" numeric(18, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_meter_reading_segments_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "reconciliation_meter_reading_segments_reading_segment_uidx" UNIQUE("tenant_id","station_id","reconciliation_meter_reading_id","meter_segment_id"),
	CONSTRAINT "reconciliation_meter_reading_segments_segment_uidx" UNIQUE("tenant_id","station_id","meter_segment_id"),
	CONSTRAINT "reconciliation_meter_reading_segments_nonnegative_litres_ck" CHECK ("app"."reconciliation_meter_reading_segments"."allocated_litres" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_reading_segments" ADD CONSTRAINT "reconciliation_meter_reading_segments_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_reading_segments" ADD CONSTRAINT "reconciliation_meter_reading_segments_revision_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id","revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id","station_id","reconciliation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_reading_segments" ADD CONSTRAINT "reconciliation_meter_reading_segments_reading_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id","reconciliation_meter_reading_id") REFERENCES "app"."reconciliation_meter_readings"("tenant_id","station_id","reconciliation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_reading_segments" ADD CONSTRAINT "reconciliation_meter_reading_segments_meter_segment_fk" FOREIGN KEY ("tenant_id","station_id","meter_segment_id") REFERENCES "app"."meter_segments"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_meter_reading_segments_reading_idx" ON "app"."reconciliation_meter_reading_segments" USING btree ("tenant_id","station_id","reconciliation_id","revision_id","reconciliation_meter_reading_id");--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_reconciliation_id_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","id");--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id");--> statement-breakpoint
ALTER TABLE "app"."reconciliation_meter_readings" ADD CONSTRAINT "reconciliation_meter_readings_reconciliation_id_uidx" UNIQUE("tenant_id","station_id","reconciliation_id","id");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_validate_reconciliation_meter_reading_segment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reconciliation_state text;
  reconciliation_business_day_id uuid;
  revision_state text;
  reading_shift_id uuid;
  reading_nozzle_id uuid;
  reading_product_id uuid;
  segment_state text;
  segment_business_day_id uuid;
  segment_shift_id uuid;
  segment_nozzle_id uuid;
  segment_product_id uuid;
  segment_litres numeric(18,3);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage is append-only; use a named correction';
  END IF;

  SELECT state, business_day_id
    INTO reconciliation_state, reconciliation_business_day_id
    FROM app.reconciliations
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND id = NEW.reconciliation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage requires the same tenant and station reconciliation';
  END IF;
  IF reconciliation_state NOT IN ('SUBMITTED', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage can only be added while reconciliation is submitted or pending approval';
  END IF;

  SELECT state
    INTO revision_state
    FROM app.reconciliation_revisions
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND reconciliation_id = NEW.reconciliation_id
     AND id = NEW.revision_id
   FOR UPDATE;
  IF NOT FOUND OR revision_state <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage requires a PENDING_APPROVAL revision';
  END IF;

  SELECT shift_id, nozzle_id, product_id
    INTO reading_shift_id, reading_nozzle_id, reading_product_id
    FROM app.reconciliation_meter_readings
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND reconciliation_id = NEW.reconciliation_id
     AND id = NEW.reconciliation_meter_reading_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage requires the reading from the same reconciliation';
  END IF;

  SELECT state, business_day_id, shift_id, nozzle_id, product_id, litres
    INTO segment_state, segment_business_day_id, segment_shift_id, segment_nozzle_id, segment_product_id, segment_litres
    FROM app.meter_segments
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND id = NEW.meter_segment_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage requires the referenced meter segment';
  END IF;
  IF segment_state <> 'SEALED' THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage requires a SEALED meter segment';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM app.meter_segments successor
     WHERE successor.tenant_id = NEW.tenant_id
       AND successor.station_id = NEW.station_id
       AND (successor.correction_of_segment_id = NEW.meter_segment_id
            OR successor.reversal_of_segment_id = NEW.meter_segment_id)
  ) THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage cannot reference a superseded meter segment';
  END IF;
  IF reconciliation_business_day_id IS DISTINCT FROM segment_business_day_id THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage must use the reconciliation business day';
  END IF;
  IF reading_shift_id IS DISTINCT FROM segment_shift_id
     OR reading_nozzle_id IS DISTINCT FROM segment_nozzle_id
     OR reading_product_id IS DISTINCT FROM segment_product_id THEN
    RAISE EXCEPTION 'reconciliation meter-segment lineage must match shift, nozzle, and product';
  END IF;
  IF NEW.allocated_litres IS DISTINCT FROM segment_litres THEN
    RAISE EXCEPTION 'reconciliation meter-segment allocation must equal the authoritative segment litres';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER reconciliation_meter_reading_segments_context_guard
BEFORE INSERT OR UPDATE OR DELETE ON app.reconciliation_meter_reading_segments
FOR EACH ROW EXECUTE FUNCTION app.a12_validate_reconciliation_meter_reading_segment();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_validate_reconciliation_approval_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_revision_id uuid;
BEGIN
  IF NEW.state <> 'APPROVED' OR OLD.state NOT IN ('SUBMITTED', 'PENDING_APPROVAL') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'reconciliation_revisions' THEN
    approval_revision_id := NEW.id;
  ELSE
    SELECT id
      INTO approval_revision_id
      FROM app.reconciliation_revisions
     WHERE tenant_id = NEW.tenant_id
       AND station_id = NEW.station_id
       AND reconciliation_id = NEW.id
       AND state IN ('PENDING_APPROVAL', 'APPROVED')
     ORDER BY revision DESC, id DESC
     LIMIT 1
     FOR SHARE;
  END IF;
  IF approval_revision_id IS NULL THEN
    RAISE EXCEPTION 'reconciliation approval requires an authoritative pending revision';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM app.reconciliation_meter_readings reading
     WHERE reading.tenant_id = NEW.tenant_id
       AND reading.station_id = NEW.station_id
       AND reading.reconciliation_id = CASE
         WHEN TG_TABLE_NAME = 'reconciliation_revisions' THEN NEW.reconciliation_id
         ELSE NEW.id
       END
       AND NOT EXISTS (
         SELECT 1
           FROM app.reconciliation_meter_reading_segments bridge
          WHERE bridge.tenant_id = reading.tenant_id
            AND bridge.station_id = reading.station_id
            AND bridge.reconciliation_id = reading.reconciliation_id
            AND bridge.revision_id = approval_revision_id
            AND bridge.reconciliation_meter_reading_id = reading.id
       )
  ) THEN
    RAISE EXCEPTION 'reconciliation approval requires lineage for every meter reading, including zero-litre readings';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM app.reconciliation_meter_readings reading
     WHERE reading.tenant_id = NEW.tenant_id
       AND reading.station_id = NEW.station_id
       AND reading.reconciliation_id = CASE
         WHEN TG_TABLE_NAME = 'reconciliation_revisions' THEN NEW.reconciliation_id
         ELSE NEW.id
       END
       AND (
         SELECT COALESCE(SUM(bridge.allocated_litres), 0)
           FROM app.reconciliation_meter_reading_segments bridge
          WHERE bridge.tenant_id = reading.tenant_id
            AND bridge.station_id = reading.station_id
            AND bridge.reconciliation_id = reading.reconciliation_id
            AND bridge.revision_id = approval_revision_id
            AND bridge.reconciliation_meter_reading_id = reading.id
       ) IS DISTINCT FROM reading.litres_sold
  ) THEN
    RAISE EXCEPTION 'reconciliation approval requires bridge litres to equal each meter reading at three-decimal precision';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM app.reconciliation_meter_reading_segments bridge
     WHERE bridge.tenant_id = NEW.tenant_id
       AND bridge.station_id = NEW.station_id
       AND bridge.reconciliation_id = CASE
         WHEN TG_TABLE_NAME = 'reconciliation_revisions' THEN NEW.reconciliation_id
         ELSE NEW.id
       END
       AND bridge.revision_id = approval_revision_id
       AND EXISTS (
         SELECT 1
           FROM app.reconciliation_meter_reading_segments other
          WHERE other.tenant_id = bridge.tenant_id
            AND other.station_id = bridge.station_id
            AND other.reconciliation_id = bridge.reconciliation_id
            AND other.revision_id = bridge.revision_id
            AND other.meter_segment_id = bridge.meter_segment_id
            AND other.reconciliation_meter_reading_id <> bridge.reconciliation_meter_reading_id
       )
  ) THEN
    RAISE EXCEPTION 'reconciliation approval cannot bridge one meter segment to multiple readings';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM app.reconciliation_meter_reading_segments bridge
      JOIN app.meter_segments segment
        ON segment.tenant_id = bridge.tenant_id
       AND segment.station_id = bridge.station_id
       AND segment.id = bridge.meter_segment_id
     WHERE bridge.tenant_id = NEW.tenant_id
       AND bridge.station_id = NEW.station_id
       AND bridge.reconciliation_id = CASE
         WHEN TG_TABLE_NAME = 'reconciliation_revisions' THEN NEW.reconciliation_id
         ELSE NEW.id
       END
       AND bridge.revision_id = approval_revision_id
       AND (
         segment.state <> 'SEALED'
         OR EXISTS (
           SELECT 1
             FROM app.meter_segments successor
            WHERE successor.tenant_id = segment.tenant_id
              AND successor.station_id = segment.station_id
              AND (successor.correction_of_segment_id = segment.id
                   OR successor.reversal_of_segment_id = segment.id)
         )
       )
  ) THEN
    RAISE EXCEPTION 'reconciliation approval cannot use an unsealed or superseded meter segment';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER reconciliations_a12_approval_completeness_guard
BEFORE UPDATE OF state ON app.reconciliations
FOR EACH ROW EXECUTE FUNCTION app.a12_validate_reconciliation_approval_completeness();
--> statement-breakpoint

CREATE TRIGGER reconciliation_revisions_a12_approval_completeness_guard
BEFORE UPDATE OF state ON app.reconciliation_revisions
FOR EACH ROW EXECUTE FUNCTION app.a12_validate_reconciliation_approval_completeness();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_validate_meter_segment_sale_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  segment_litres numeric(18,3);
  segment_product_id uuid;
  segment_end_at timestamptz;
  segment_business_date text;
BEGIN
  IF NEW.source_type <> 'METER_SEGMENT_SALE' THEN
    RETURN NEW;
  END IF;
  IF NEW.movement_type <> 'SALE' THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE source must create a SALE movement';
  END IF;

  SELECT m.litres, m.product_id, m.segment_end_at, d.business_date
    INTO segment_litres, segment_product_id, segment_end_at, segment_business_date
    FROM app.meter_segments m
    JOIN app.station_business_days d
      ON d.tenant_id = m.tenant_id
     AND d.station_id = m.station_id
     AND d.id = m.business_day_id
   WHERE m.tenant_id = NEW.tenant_id
     AND m.station_id = NEW.station_id
     AND m.id = NEW.source_id
     AND m.state = 'SEALED'
     AND NOT EXISTS (
       SELECT 1
         FROM app.meter_segments successor
        WHERE successor.tenant_id = m.tenant_id
          AND successor.station_id = m.station_id
          AND (successor.correction_of_segment_id = m.id
               OR successor.reversal_of_segment_id = m.id)
     )
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE source must reference an unsuperseded SEALED meter segment';
  END IF;
  IF segment_litres <= 0 THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE source must reference a positive-litre meter segment';
  END IF;
  IF NEW.product_id IS DISTINCT FROM segment_product_id THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE product must match the meter segment';
  END IF;
  IF NEW.quantity_litres IS DISTINCT FROM -segment_litres THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE quantity must equal negative segment litres';
  END IF;
  IF NEW.effective_at IS DISTINCT FROM segment_end_at THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE effective time must equal the meter segment end time';
  END IF;
  IF NEW.business_date IS DISTINCT FROM segment_business_date THEN
    RAISE EXCEPTION 'METER_SEGMENT_SALE business date must match the meter segment business day';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_movements_meter_segment_sale_guard
BEFORE INSERT ON app.inventory_movements
FOR EACH ROW EXECUTE FUNCTION app.a12_validate_meter_segment_sale_source();
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE app.reconciliation_meter_reading_segments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.reconciliation_meter_reading_segments FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_context ON app.reconciliation_meter_reading_segments
    USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.reconciliation_meter_reading_segments OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.reconciliation_meter_reading_segments TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.reconciliation_meter_reading_segments TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.reconciliation_meter_reading_segments TO diagnostics_readonly;
  END IF;
END
$$;
--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON app.reconciliation_meter_reading_segments FROM app_runtime;
