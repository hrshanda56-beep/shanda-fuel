-- A price change needs a second price row while the first is still in use.
-- 1) The no-overlap rule now covers only live (ACTIVE) prices: drafts and pending prices may coexist.
-- 2) An ACTIVE price may have its end date set once (NULL -> value); nothing else about it may change.
ALTER TABLE app.selling_prices DROP CONSTRAINT selling_prices_effective_no_overlap;
--> statement-breakpoint
ALTER TABLE app.selling_prices ADD CONSTRAINT selling_prices_effective_no_overlap EXCLUDE USING gist (tenant_id WITH =, station_id WITH =, product_id WITH =, tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&) WHERE (state = 'ACTIVE');
--> statement-breakpoint

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
    IF OLD.state = 'PENDING_APPROVAL' AND NEW.state = 'APPROVED' AND EXISTS (
      SELECT 1
      FROM app.reconciliation_meter_readings reading
      WHERE reading.tenant_id = NEW.tenant_id
        AND reading.station_id = NEW.station_id
        AND reading.reconciliation_id = NEW.reconciliation_id
    ) THEN
      IF NEW.source_segment_ids IS NULL OR jsonb_typeof(NEW.source_segment_ids) <> 'array' THEN
        RAISE EXCEPTION 'authoritative reconciliation revision values are immutable';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM app.reconciliation_meter_reading_segments bridge
        WHERE bridge.tenant_id = NEW.tenant_id
          AND bridge.station_id = NEW.station_id
          AND bridge.reconciliation_id = NEW.reconciliation_id
          AND bridge.revision_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'authoritative reconciliation revision values are immutable';
      END IF;
      IF jsonb_array_length(NEW.source_segment_ids) <> (
        SELECT count(*)::int
        FROM app.reconciliation_meter_reading_segments bridge
        WHERE bridge.tenant_id = NEW.tenant_id
          AND bridge.station_id = NEW.station_id
          AND bridge.reconciliation_id = NEW.reconciliation_id
          AND bridge.revision_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'authoritative reconciliation revision values are immutable';
      END IF;
      IF (
        SELECT count(DISTINCT source.value::uuid)
        FROM jsonb_array_elements_text(NEW.source_segment_ids) AS source(value)
      ) <> jsonb_array_length(NEW.source_segment_ids) THEN
        RAISE EXCEPTION 'authoritative reconciliation revision values are immutable';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM app.reconciliation_meter_reading_segments bridge
        WHERE bridge.tenant_id = NEW.tenant_id
          AND bridge.station_id = NEW.station_id
          AND bridge.reconciliation_id = NEW.reconciliation_id
          AND bridge.revision_id = NEW.id
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(NEW.source_segment_ids) AS source(value)
            WHERE source.value::uuid = bridge.meter_segment_id
          )
      ) THEN
        RAISE EXCEPTION 'authoritative reconciliation revision values are immutable';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(NEW.source_segment_ids) AS source(value)
        WHERE NOT EXISTS (
          SELECT 1
          FROM app.reconciliation_meter_reading_segments bridge
          WHERE bridge.tenant_id = NEW.tenant_id
            AND bridge.station_id = NEW.station_id
            AND bridge.reconciliation_id = NEW.reconciliation_id
            AND bridge.revision_id = NEW.id
            AND bridge.meter_segment_id = source.value::uuid
        )
      ) THEN
        RAISE EXCEPTION 'authoritative reconciliation revision values are immutable';
      END IF;
    END IF;
    IF OLD.state IN ('SUBMITTED','PENDING_APPROVAL','APPROVED','POSTED') AND (
      NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.revision IS DISTINCT FROM OLD.revision
      OR NEW.expected_sales IS DISTINCT FROM OLD.expected_sales OR NEW.accounted_sales IS DISTINCT FROM OLD.accounted_sales OR NEW.variance IS DISTINCT FROM OLD.variance
      OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.variance_classification IS DISTINCT FROM OLD.variance_classification OR NEW.declarations IS DISTINCT FROM OLD.declarations
      OR (
        NEW.source_segment_ids IS DISTINCT FROM OLD.source_segment_ids
        AND NOT (
          OLD.state = 'PENDING_APPROVAL' AND NEW.state = 'APPROVED'
          AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL
          AND NEW.version = OLD.version + 1
          AND EXISTS (
            SELECT 1
            FROM app.reconciliation_meter_readings reading
            WHERE reading.tenant_id = NEW.tenant_id
              AND reading.station_id = NEW.station_id
              AND reading.reconciliation_id = NEW.reconciliation_id
          )
        )
      ) OR NEW.source_shift_ids IS DISTINCT FROM OLD.source_shift_ids
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
    -- The one permitted change: closing an ACTIVE price's open end date when its successor takes over.
    IF OLD.state = 'ACTIVE' AND OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
       AND NEW.effective_to > OLD.effective_from
       AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'historical activated prices are immutable';
  ELSIF TG_TABLE_NAME = 'reconciliations' AND OLD.state IN ('APPROVED','POSTED','LOCKED') THEN
    IF OLD.state = 'LOCKED' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.business_day_id IS DISTINCT FROM OLD.business_day_id THEN RAISE EXCEPTION 'approved, posted, and locked reconciliations are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
