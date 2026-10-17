ALTER TABLE app.cash_handovers
  ADD COLUMN transit_location_id uuid,
  ADD COLUMN business_date text,
  ADD COLUMN variance_explanation text,
  ADD COLUMN resolution_reason text,
  ADD COLUMN cancellation_reason text;
--> statement-breakpoint
UPDATE app.cash_handovers
SET transit_location_id = (
      SELECT location.id
      FROM app.cash_locations location
      WHERE location.tenant_id = cash_handovers.tenant_id
        AND location.station_id = cash_handovers.station_id
        AND location.location_type = 'TRANSIT'
        AND location.status = 'ACTIVE'
      ORDER BY location.id
      LIMIT 1
    ),
    business_date = to_char(coalesce(submitted_at, created_at)::date, 'YYYY-MM-DD')
WHERE transit_location_id IS NULL OR business_date IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.cash_handovers WHERE transit_location_id IS NULL OR business_date IS NULL) THEN
    RAISE EXCEPTION 'Cash handover migration requires an active TRANSIT cash location for every existing station';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE app.cash_handovers
  ALTER COLUMN transit_location_id SET NOT NULL,
  ALTER COLUMN business_date SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app.cash_handovers
  DROP CONSTRAINT cash_handovers_locations_differ_ck;
--> statement-breakpoint
ALTER TABLE app.cash_handovers
  ADD CONSTRAINT cash_handovers_locations_differ_ck
  CHECK (from_location_id <> to_location_id AND from_location_id <> transit_location_id AND to_location_id <> transit_location_id);
--> statement-breakpoint
ALTER TABLE app.cash_handovers
  ADD CONSTRAINT cash_handovers_transit_location_fk
  FOREIGN KEY (tenant_id, station_id, transit_location_id)
  REFERENCES app.cash_locations (tenant_id, station_id, id);
--> statement-breakpoint
CREATE INDEX cash_handovers_tenant_station_business_date_idx
  ON app.cash_handovers (tenant_id, station_id, business_date);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.cash_handovers OWNER TO migration_owner;
  END IF;
END
$$;
