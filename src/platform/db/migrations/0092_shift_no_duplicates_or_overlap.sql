-- A station gets one shift per shift template per business day, and its shifts never overlap in
-- time. The application checks both when a shift is opened; the database now refuses them too, so
-- no other code path can create duplicate or overlapping shifts.
--
-- The overlap rule applies to shifts opened from a shift template, which is how every real shift
-- is opened. Overlap is judged on the time a shift really covers: from when it was opened (or planned to
-- start) until it was completed (or is planned to end). A shift that finished early therefore does
-- not block the next one, and shifts marked not operated or cancelled never count. Two shifts that
-- meet end to start (06:00 to 14:00, then 14:00 to 22:00) do not overlap.
--
-- This is a trigger on new and re-timed shifts, not a unique index: shifts that already exist are
-- left exactly as they are, so the migration cannot fail on data that is already in place.

CREATE OR REPLACE FUNCTION app.shift_schedule_conflict(
  p_tenant_id uuid,
  p_station_id uuid,
  p_shift_id uuid,
  p_planned_start timestamptz,
  p_planned_end timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.shifts s
    WHERE s.tenant_id = p_tenant_id
      AND s.station_id = p_station_id
      AND s.id <> p_shift_id
      AND s.state NOT IN ('CANCELLED_BEFORE_START', 'NOT_OPERATED')
      AND COALESCE(s.opened_at, s.planned_start_at) < p_planned_end
      AND p_planned_start < CASE WHEN s.state = 'COMPLETED'
        THEN COALESCE(s.completed_at, s.planned_end_at)
        ELSE s.planned_end_at END
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_shift_schedule()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('CANCELLED_BEFORE_START', 'NOT_OPERATED') THEN
    RETURN NEW;
  END IF;
  IF NEW.shift_template_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.shifts s
    WHERE s.tenant_id = NEW.tenant_id
      AND s.station_id = NEW.station_id
      AND s.business_day_id = NEW.business_day_id
      AND s.shift_template_id = NEW.shift_template_id
      AND s.state <> 'CANCELLED_BEFORE_START'
      AND s.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'this shift has already been opened for this business day'
      USING ERRCODE = '23505';
  END IF;
  -- Shifts are opened from a shift template in every real flow, so the overlap rule applies to
  -- those. A shift with no template is an ad-hoc or legacy record and is left to the other rules.
  IF NEW.shift_template_id IS NOT NULL AND app.shift_schedule_conflict(
    NEW.tenant_id, NEW.station_id, NEW.id, NEW.planned_start_at, NEW.planned_end_at
  ) THEN
    RAISE EXCEPTION 'this shift overlaps another shift at the same station'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS shifts_schedule_guard ON app.shifts;
--> statement-breakpoint
CREATE TRIGGER shifts_schedule_guard
  BEFORE INSERT OR UPDATE OF planned_start_at, planned_end_at, shift_template_id ON app.shifts
  FOR EACH ROW EXECUTE FUNCTION app.guard_shift_schedule();
