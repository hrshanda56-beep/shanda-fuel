-- A red stock variance needs an explicit management note before approval.
ALTER TABLE app.reconciliations
  ADD COLUMN approval_note text;
--> statement-breakpoint
ALTER TABLE app.tank_dips
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid,
  ADD COLUMN void_reason text;
--> statement-breakpoint
ALTER TABLE app.tank_dips
  ADD CONSTRAINT tank_dips_voided_by_fk
  FOREIGN KEY (tenant_id, voided_by) REFERENCES app.memberships (tenant_id, id),
  ADD CONSTRAINT tank_dips_void_fields_ck
  CHECK ((voided_at is null and voided_by is null and void_reason is null)
      or (voided_at is not null and voided_by is not null and void_reason is not null and length(trim(void_reason)) >= 5));
--> statement-breakpoint
DROP TRIGGER tank_dips_immutable_guard ON app.tank_dips;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.a4_allow_tank_dip_void()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tank dips cannot be deleted';
  END IF;
  IF OLD.voided_at IS NOT NULL
     OR NEW.voided_at IS NULL
     OR NEW.voided_by IS NULL
     OR NEW.void_reason IS NULL
     OR length(trim(NEW.void_reason)) < 5
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.station_id IS DISTINCT FROM OLD.station_id
     OR NEW.tank_id IS DISTINCT FROM OLD.tank_id
     OR NEW.measured_at IS DISTINCT FROM OLD.measured_at
     OR NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.physical_litres IS DISTINCT FROM OLD.physical_litres
     OR NEW.raw_measurement IS DISTINCT FROM OLD.raw_measurement
     OR NEW.measurement_unit IS DISTINCT FROM OLD.measurement_unit
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'tank dips are immutable except for one void action';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tank_dips_immutable_guard BEFORE UPDATE OR DELETE ON app.tank_dips FOR EACH ROW EXECUTE FUNCTION app.a4_allow_tank_dip_void();
--> statement-breakpoint
GRANT UPDATE ON app.tank_dips TO app_runtime;
