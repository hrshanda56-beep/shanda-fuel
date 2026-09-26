ALTER TABLE app.inventory_cost_events
  DROP CONSTRAINT inventory_cost_events_amount_nonzero_ck;
--> statement-breakpoint

ALTER TABLE app.inventory_cost_events
  ADD CONSTRAINT inventory_cost_events_amount_nonzero_ck
  CHECK (event_type = 'COGS_REVALUATION' OR amount <> 0);
--> statement-breakpoint

ALTER TABLE app.inventory_cost_revaluations
  ADD COLUMN source_type text,
  ADD COLUMN source_id uuid,
  ADD COLUMN amount numeric(20, 4),
  ADD COLUMN currency text,
  ADD COLUMN posted_by uuid,
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN replay_fingerprint text;
--> statement-breakpoint

ALTER TABLE app.inventory_cost_revaluations
  ADD CONSTRAINT inventory_cost_revaluations_currency_nonempty_ck
  CHECK (currency IS NULL OR btrim(currency) <> ''),
  ADD CONSTRAINT inventory_cost_revaluations_amount_positive_ck
  CHECK (amount IS NULL OR amount > 0),
  ADD CONSTRAINT inventory_cost_revaluations_posted_fields_ck
  CHECK (
    status <> 'POSTED'
    OR (
      source_type IS NOT NULL
      AND source_id IS NOT NULL
      AND amount IS NOT NULL
      AND currency IS NOT NULL
      AND posted_by IS NOT NULL
      AND posted_at IS NOT NULL
      AND replay_fingerprint IS NOT NULL
      AND btrim(replay_fingerprint) <> ''
    )
  ),
  ADD CONSTRAINT inventory_cost_revaluations_source_uidx
  UNIQUE (tenant_id, source_type, source_id),
  ADD CONSTRAINT inventory_cost_revaluations_posted_by_fk
  FOREIGN KEY (tenant_id, posted_by)
  REFERENCES app.memberships (tenant_id, id);
--> statement-breakpoint

CREATE TABLE app.inventory_cost_revaluation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  tank_id uuid NOT NULL,
  product_id uuid NOT NULL,
  revaluation_id uuid NOT NULL,
  sale_movement_id uuid NOT NULL,
  sale_attribution_id uuid NOT NULL,
  original_pre_sale_wac numeric(20, 8) NOT NULL,
  recomputed_pre_sale_wac numeric(20, 8) NOT NULL,
  original_cogs numeric(20, 4) NOT NULL,
  prior_restated_cogs numeric(20, 4) NOT NULL,
  recomputed_cogs numeric(20, 4) NOT NULL,
  cogs_delta numeric(20, 4) NOT NULL,
  currency text NOT NULL,
  sale_effective_at timestamptz NOT NULL,
  cogs_revaluation_event_id uuid NOT NULL,
  replay_fingerprint text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT inventory_cost_revaluation_lines_tenant_id_id_uidx UNIQUE (tenant_id, id),
  CONSTRAINT inventory_cost_revaluation_lines_revaluation_sale_uidx
    UNIQUE (tenant_id, revaluation_id, sale_movement_id),
  CONSTRAINT inventory_cost_revaluation_lines_currency_nonempty_ck
    CHECK (btrim(currency) <> ''),
  CONSTRAINT inventory_cost_revaluation_lines_fingerprint_nonempty_ck
    CHECK (btrim(replay_fingerprint) <> ''),
  CONSTRAINT inventory_cost_revaluation_lines_delta_arithmetic_ck
    CHECK (recomputed_cogs = prior_restated_cogs + cogs_delta),
  CONSTRAINT inventory_cost_revaluation_lines_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES app.tenants (id),
  CONSTRAINT inventory_cost_revaluation_lines_station_fk
    FOREIGN KEY (tenant_id, station_id) REFERENCES app.stations (tenant_id, id),
  CONSTRAINT inventory_cost_revaluation_lines_tank_product_fk
    FOREIGN KEY (tenant_id, station_id, tank_id, product_id)
    REFERENCES app.tanks (tenant_id, station_id, id, product_id),
  CONSTRAINT inventory_cost_revaluation_lines_revaluation_fk
    FOREIGN KEY (tenant_id, revaluation_id)
    REFERENCES app.inventory_cost_revaluations (tenant_id, id),
  CONSTRAINT inventory_cost_revaluation_lines_sale_movement_fk
    FOREIGN KEY (tenant_id, sale_movement_id)
    REFERENCES app.inventory_movements (tenant_id, id),
  CONSTRAINT inventory_cost_revaluation_lines_sale_attribution_fk
    FOREIGN KEY (tenant_id, sale_attribution_id)
    REFERENCES app.inventory_sale_cost_attributions (tenant_id, id),
  CONSTRAINT inventory_cost_revaluation_lines_cogs_event_fk
    FOREIGN KEY (tenant_id, cogs_revaluation_event_id)
    REFERENCES app.inventory_cost_events (tenant_id, id)
);
--> statement-breakpoint

CREATE INDEX inventory_cost_revaluation_lines_revaluation_idx
  ON app.inventory_cost_revaluation_lines
    (tenant_id, revaluation_id, sale_effective_at, sale_movement_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_revaluation_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory cost revaluations are immutable; use explicit workflow transitions';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED'
       OR NEW.approved_by IS NOT NULL
       OR NEW.approved_at IS NOT NULL
       OR NEW.posted_by IS NOT NULL
       OR NEW.posted_at IS NOT NULL
       OR NEW.replay_fingerprint IS NOT NULL THEN
      RAISE EXCEPTION 'inventory cost revaluations must be created in REQUESTED state';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.station_id IS DISTINCT FROM OLD.station_id
     OR NEW.tank_id IS DISTINCT FROM OLD.tank_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
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
  IF NEW.status <> 'APPROVED'
     AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'approval provenance can only be set during approval';
  END IF;
  IF NEW.status = 'POSTED'
     AND (NEW.posted_by IS NULL OR NEW.posted_at IS NULL OR NEW.replay_fingerprint IS NULL
       OR btrim(NEW.replay_fingerprint) = '') THEN
    RAISE EXCEPTION 'posted inventory cost revaluations require posting provenance and replay fingerprint';
  END IF;
  IF NEW.status <> 'POSTED'
     AND (NEW.posted_by IS NOT NULL OR NEW.posted_at IS NOT NULL OR NEW.replay_fingerprint IS NOT NULL) THEN
    RAISE EXCEPTION 'posting provenance can only be set during posting';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_revaluation_line_mutation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory cost revaluation lines are immutable';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_cost_revaluation_lines_append_only
BEFORE UPDATE OR DELETE ON app.inventory_cost_revaluation_lines
FOR EACH ROW EXECUTE FUNCTION app.a12_revaluation_line_mutation_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a12_validate_revaluation_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revaluation record;
  attribution record;
  movement record;
  cost_event record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'inventory cost revaluation lines are append-only';
  END IF;

  SELECT tenant_id, station_id, tank_id, product_id, status
    INTO revaluation
    FROM app.inventory_cost_revaluations
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.revaluation_id
   FOR SHARE;
  IF NOT FOUND
     OR revaluation.station_id <> NEW.station_id
     OR revaluation.tank_id <> NEW.tank_id
     OR revaluation.product_id <> NEW.product_id
     OR revaluation.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'revaluation line must belong to an approved revaluation stream';
  END IF;

  SELECT tenant_id, station_id, tank_id, product_id, movement_type, source_type,
         source_id, quantity_litres, effective_at, business_date
    INTO movement
    FROM app.inventory_movements
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.sale_movement_id
   FOR SHARE;
  IF NOT FOUND
     OR movement.station_id <> NEW.station_id
     OR movement.tank_id <> NEW.tank_id
     OR movement.product_id <> NEW.product_id
     OR movement.movement_type <> 'SALE'
     OR movement.source_type <> 'METER_SEGMENT_SALE'
     OR movement.quantity_litres >= 0
     OR movement.effective_at IS DISTINCT FROM NEW.sale_effective_at THEN
    RAISE EXCEPTION 'revaluation line must reference its canonical sale movement';
  END IF;

  SELECT tenant_id, station_id, tank_id, product_id, inventory_movement_id,
         original_cogs, pre_sale_wac, effective_at
    INTO attribution
    FROM app.inventory_sale_cost_attributions
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.sale_attribution_id
   FOR SHARE;
  IF NOT FOUND
     OR attribution.station_id <> NEW.station_id
     OR attribution.tank_id <> NEW.tank_id
     OR attribution.product_id <> NEW.product_id
     OR attribution.inventory_movement_id <> NEW.sale_movement_id
     OR attribution.original_cogs IS DISTINCT FROM NEW.original_cogs
     OR attribution.pre_sale_wac IS DISTINCT FROM NEW.original_pre_sale_wac
     OR attribution.effective_at IS DISTINCT FROM NEW.sale_effective_at THEN
    RAISE EXCEPTION 'revaluation line must preserve the original sale attribution';
  END IF;

  SELECT event_type, source_type, source_id, tenant_id, station_id, tank_id,
         product_id, effective_at, amount, currency
    INTO cost_event
    FROM app.inventory_cost_events
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.cogs_revaluation_event_id
   FOR SHARE;
  IF NOT FOUND
     OR cost_event.event_type <> 'COGS_REVALUATION'
     OR cost_event.source_type <> 'INVENTORY_COST_REVALUATION_LINE'
     OR cost_event.source_id <> NEW.id
     OR cost_event.station_id <> NEW.station_id
     OR cost_event.tank_id <> NEW.tank_id
     OR cost_event.product_id <> NEW.product_id
     OR cost_event.effective_at IS DISTINCT FROM NEW.sale_effective_at
     OR cost_event.amount IS DISTINCT FROM NEW.cogs_delta
     OR cost_event.currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'revaluation line must reference its signed COGS_REVALUATION event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER inventory_cost_revaluation_lines_context_guard
BEFORE INSERT ON app.inventory_cost_revaluation_lines
FOR EACH ROW EXECUTE FUNCTION app.a12_validate_revaluation_line();
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE app.inventory_cost_revaluation_lines ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.inventory_cost_revaluation_lines FORCE ROW LEVEL SECURITY;
  CREATE POLICY inventory_cost_revaluation_lines_tenant_station_context
    ON app.inventory_cost_revaluation_lines
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

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.inventory_cost_revaluation_lines OWNER TO migration_owner;
    ALTER FUNCTION app.a12_revaluation_line_mutation_guard() OWNER TO migration_owner;
    ALTER FUNCTION app.a12_validate_revaluation_line() OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.inventory_cost_revaluation_lines TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
      ON app.inventory_cost_revaluation_lines FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.inventory_cost_revaluation_lines TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.inventory_cost_revaluation_lines TO diagnostics_readonly;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.a12_revaluation_transition_guard() OWNER TO migration_owner;
  END IF;
END
$$;
