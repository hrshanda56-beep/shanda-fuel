CREATE TABLE app.sale_recognition_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  station_id uuid NOT NULL,
  business_date text NOT NULL,
  product_id uuid NOT NULL,
  tank_id uuid NOT NULL,
  nozzle_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  meter_segment_id uuid NOT NULL,
  inventory_sale_movement_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  reconciliation_revision_id uuid NOT NULL,
  reconciliation_meter_reading_id uuid NOT NULL,
  quantity_litres numeric(18,3) NOT NULL,
  reconciliation_value numeric(20,4) NOT NULL,
  recognized_revenue_amount numeric(20,4) NOT NULL,
  currency text DEFAULT 'USD' NOT NULL,
  effective_at timestamptz NOT NULL,
  posted_at timestamptz DEFAULT now() NOT NULL,
  classification text DEFAULT 'ORDINARY_FUEL_SALE' NOT NULL,
  source_type text DEFAULT 'METER_SEGMENT_SALE' NOT NULL,
  source_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  request_id uuid NOT NULL,
  replay_fingerprint text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT sale_recognition_movements_tenant_id_id_uidx UNIQUE (tenant_id, id),
  CONSTRAINT sale_recognition_movements_source_uidx UNIQUE (tenant_id, source_type, source_id, classification),
  CONSTRAINT sale_recognition_movements_segment_uidx UNIQUE (tenant_id, station_id, meter_segment_id, classification),
  CONSTRAINT sale_recognition_movements_classification_ck CHECK (classification = 'ORDINARY_FUEL_SALE'),
  CONSTRAINT sale_recognition_movements_source_type_ck CHECK (source_type = 'METER_SEGMENT_SALE'),
  CONSTRAINT sale_recognition_movements_currency_ck CHECK (currency = 'USD'),
  CONSTRAINT sale_recognition_movements_positive_quantity_ck CHECK (quantity_litres > 0),
  CONSTRAINT sale_recognition_movements_positive_amount_ck CHECK (recognized_revenue_amount > 0),
  CONSTRAINT sale_recognition_movements_reconciliation_amount_ck CHECK (reconciliation_value = recognized_revenue_amount),
  CONSTRAINT sale_recognition_movements_source_id_ck CHECK (source_id = meter_segment_id),
  CONSTRAINT sale_recognition_movements_fingerprint_ck CHECK (btrim(replay_fingerprint) <> ''),
  CONSTRAINT sale_recognition_movements_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (id),
  CONSTRAINT sale_recognition_movements_legal_entity_fk FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities (tenant_id, id),
  CONSTRAINT sale_recognition_movements_station_legal_entity_fk FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations (tenant_id, legal_entity_id, id),
  CONSTRAINT sale_recognition_movements_product_fk FOREIGN KEY (tenant_id, product_id)
    REFERENCES app.products (tenant_id, id),
  CONSTRAINT sale_recognition_movements_tank_product_fk FOREIGN KEY (tenant_id, station_id, tank_id, product_id)
    REFERENCES app.tanks (tenant_id, station_id, id, product_id),
  CONSTRAINT sale_recognition_movements_nozzle_fk FOREIGN KEY (tenant_id, station_id, nozzle_id)
    REFERENCES app.nozzles (tenant_id, station_id, id),
  CONSTRAINT sale_recognition_movements_shift_fk FOREIGN KEY (tenant_id, station_id, shift_id)
    REFERENCES app.shifts (tenant_id, station_id, id),
  CONSTRAINT sale_recognition_movements_meter_segment_fk FOREIGN KEY (tenant_id, station_id, meter_segment_id)
    REFERENCES app.meter_segments (tenant_id, station_id, id),
  CONSTRAINT sale_recognition_movements_inventory_sale_fk FOREIGN KEY (tenant_id, inventory_sale_movement_id)
    REFERENCES app.inventory_movements (tenant_id, id),
  CONSTRAINT sale_recognition_movements_reconciliation_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id)
    REFERENCES app.reconciliations (tenant_id, station_id, id),
  CONSTRAINT sale_recognition_movements_revision_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id, reconciliation_revision_id)
    REFERENCES app.reconciliation_revisions (tenant_id, station_id, reconciliation_id, id),
  CONSTRAINT sale_recognition_movements_meter_reading_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id, reconciliation_meter_reading_id)
    REFERENCES app.reconciliation_meter_readings (tenant_id, station_id, reconciliation_id, id),
  CONSTRAINT sale_recognition_movements_actor_fk FOREIGN KEY (tenant_id, actor_membership_id)
    REFERENCES app.memberships (tenant_id, id)
);
--> statement-breakpoint

CREATE INDEX sale_recognition_movements_station_business_date_idx
  ON app.sale_recognition_movements (tenant_id, station_id, business_date);
--> statement-breakpoint
CREATE INDEX sale_recognition_movements_effective_idx
  ON app.sale_recognition_movements (tenant_id, station_id, effective_at, id);
--> statement-breakpoint
CREATE INDEX sale_recognition_movements_product_idx
  ON app.sale_recognition_movements (tenant_id, station_id, product_id, business_date);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.rev1_sale_revenue_mutation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'canonical sale revenue movements are immutable; use a named correction or reversal workflow';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.rev1_validate_sale_recognition_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  segment record;
  reading record;
  movement record;
  revision_state text;
  reconciliation_state text;
  station_legal_entity_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'canonical sale revenue movements are append-only';
  END IF;

  SELECT legal_entity_id
    INTO station_legal_entity_id
    FROM app.stations
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.station_id;
  IF NOT FOUND OR station_legal_entity_id IS DISTINCT FROM NEW.legal_entity_id THEN
    RAISE EXCEPTION 'sale revenue station and legal entity do not match';
  END IF;

  SELECT m.state, m.business_day_id, m.shift_id, m.nozzle_id, m.product_id,
         m.litres, m.unit_price, m.currency, m.segment_end_at, d.business_date
    INTO segment
    FROM app.meter_segments m
    JOIN app.station_business_days d
      ON d.tenant_id = m.tenant_id
     AND d.station_id = m.station_id
     AND d.id = m.business_day_id
   WHERE m.tenant_id = NEW.tenant_id
     AND m.station_id = NEW.station_id
     AND m.id = NEW.meter_segment_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale revenue requires the referenced meter segment';
  END IF;
  IF segment.state <> 'SEALED' THEN
    RAISE EXCEPTION 'sale revenue requires a SEALED meter segment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.meter_segments successor
     WHERE successor.tenant_id = NEW.tenant_id
       AND successor.station_id = NEW.station_id
       AND (successor.correction_of_segment_id = NEW.meter_segment_id
         OR successor.reversal_of_segment_id = NEW.meter_segment_id)
  ) THEN
    RAISE EXCEPTION 'sale revenue cannot reference a superseded meter segment';
  END IF;

  IF NEW.business_date IS DISTINCT FROM segment.business_date
     OR NEW.product_id IS DISTINCT FROM segment.product_id
     OR NEW.nozzle_id IS DISTINCT FROM segment.nozzle_id
     OR NEW.shift_id IS DISTINCT FROM segment.shift_id
     OR NEW.quantity_litres IS DISTINCT FROM segment.litres
     OR NEW.effective_at IS DISTINCT FROM segment.segment_end_at
     OR NEW.currency IS DISTINCT FROM segment.currency
     OR NEW.reconciliation_value IS DISTINCT FROM round(segment.litres * segment.unit_price, 4)
     OR NEW.recognized_revenue_amount IS DISTINCT FROM round(segment.litres * segment.unit_price, 4) THEN
    RAISE EXCEPTION 'sale revenue must equal the sealed segment litres at its effective selling price';
  END IF;

  SELECT state
    INTO revision_state
    FROM app.reconciliation_revisions
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND reconciliation_id = NEW.reconciliation_id
     AND id = NEW.reconciliation_revision_id
   FOR SHARE;
  IF revision_state IS NULL OR revision_state NOT IN ('PENDING_APPROVAL', 'APPROVED', 'POSTED', 'LOCKED') THEN
    RAISE EXCEPTION 'sale revenue requires an in-flight or approved reconciliation revision';
  END IF;

  SELECT state
    INTO reconciliation_state
    FROM app.reconciliations
   WHERE tenant_id = NEW.tenant_id
     AND station_id = NEW.station_id
     AND id = NEW.reconciliation_id
   FOR SHARE;
  IF reconciliation_state IS NULL OR reconciliation_state NOT IN ('SUBMITTED', 'APPROVED', 'POSTED', 'LOCKED') THEN
    RAISE EXCEPTION 'sale revenue requires an in-flight or approved reconciliation';
  END IF;

  SELECT r.shift_id, r.nozzle_id, r.product_id
    INTO reading
    FROM app.reconciliation_meter_readings r
   WHERE r.tenant_id = NEW.tenant_id
     AND r.station_id = NEW.station_id
     AND r.reconciliation_id = NEW.reconciliation_id
     AND r.id = NEW.reconciliation_meter_reading_id;
  IF NOT FOUND
     OR reading.shift_id IS DISTINCT FROM NEW.shift_id
     OR reading.nozzle_id IS DISTINCT FROM NEW.nozzle_id
     OR reading.product_id IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'sale revenue requires matching A5 reading lineage';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM app.reconciliation_meter_reading_segments bridge
     WHERE bridge.tenant_id = NEW.tenant_id
       AND bridge.station_id = NEW.station_id
       AND bridge.reconciliation_id = NEW.reconciliation_id
       AND bridge.revision_id = NEW.reconciliation_revision_id
       AND bridge.reconciliation_meter_reading_id = NEW.reconciliation_meter_reading_id
       AND bridge.meter_segment_id = NEW.meter_segment_id
       AND bridge.allocated_litres = segment.litres
  ) THEN
    RAISE EXCEPTION 'sale revenue requires the approved A5-to-A3 segment bridge';
  END IF;

  SELECT movement_type, source_type, source_id, station_id, tank_id, product_id,
         quantity_litres, effective_at, business_date
    INTO movement
    FROM app.inventory_movements
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.inventory_sale_movement_id
   FOR SHARE;
  IF NOT FOUND
     OR movement.movement_type <> 'SALE'
     OR movement.source_type <> 'METER_SEGMENT_SALE'
     OR movement.source_id IS DISTINCT FROM NEW.meter_segment_id
     OR movement.station_id IS DISTINCT FROM NEW.station_id
     OR movement.tank_id IS DISTINCT FROM NEW.tank_id
     OR movement.product_id IS DISTINCT FROM NEW.product_id
     OR movement.quantity_litres IS DISTINCT FROM (-segment.litres)
     OR movement.effective_at IS DISTINCT FROM segment.segment_end_at
     OR movement.business_date IS DISTINCT FROM segment.business_date THEN
    RAISE EXCEPTION 'sale revenue requires the matching canonical A4 SALE movement';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM app.inventory_sale_cost_attributions attribution
      JOIN app.inventory_cost_events cost_event
        ON cost_event.tenant_id = attribution.tenant_id
       AND cost_event.id = attribution.sale_cost_event_id
     WHERE attribution.tenant_id = NEW.tenant_id
       AND attribution.station_id = NEW.station_id
       AND attribution.inventory_movement_id = NEW.inventory_sale_movement_id
       AND attribution.meter_segment_id = NEW.meter_segment_id
       AND attribution.tank_id = NEW.tank_id
       AND attribution.product_id = NEW.product_id
       AND attribution.sale_quantity_litres = NEW.quantity_litres
       AND attribution.effective_at = NEW.effective_at
       AND attribution.business_date = NEW.business_date
       AND cost_event.event_type = 'SALE_COGS'
       AND cost_event.source_type = 'METER_SEGMENT_SALE'
       AND cost_event.source_id = NEW.meter_segment_id
  ) THEN
    RAISE EXCEPTION 'sale revenue requires the matching A12 SALE_COGS attribution';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sale_recognition_movements_mutation_guard
BEFORE UPDATE OR DELETE ON app.sale_recognition_movements
FOR EACH ROW EXECUTE FUNCTION app.rev1_sale_revenue_mutation_guard();
--> statement-breakpoint
CREATE TRIGGER sale_recognition_movements_context_guard
BEFORE INSERT ON app.sale_recognition_movements
FOR EACH ROW EXECUTE FUNCTION app.rev1_validate_sale_recognition_movement();
--> statement-breakpoint

ALTER TABLE app.sale_recognition_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sale_recognition_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_recognition_movements_tenant_station_context
  ON app.sale_recognition_movements
  USING (
    tenant_id = app.current_tenant_id()
    AND app.has_active_membership()
    AND (app.current_station_id() IS NULL OR station_id = app.current_station_id())
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.has_active_membership()
    AND (app.current_station_id() IS NULL OR station_id = app.current_station_id())
  );
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.sale_recognition_movements OWNER TO migration_owner;
    ALTER FUNCTION app.rev1_sale_revenue_mutation_guard() OWNER TO migration_owner;
    ALTER FUNCTION app.rev1_validate_sale_recognition_movement() OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.sale_recognition_movements TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
      ON app.sale_recognition_movements FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.sale_recognition_movements TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.sale_recognition_movements TO diagnostics_readonly;
  END IF;
END
$$;
