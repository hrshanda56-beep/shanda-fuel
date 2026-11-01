-- Hardening guards for features that already exist. No new tables or columns.
--
-- 1. A bank deposit cannot be confirmed without a deposit slip on file. The application checks
--    this already; the database now refuses it too, so no other code path can skip it.
-- 2. Meter boundaries are append-only history. The one allowed change is linking a boundary to a
--    price change after the fact (price_change_id from NULL to a value).
-- 3. A shift cannot be moved to another station, business day or business date.

CREATE OR REPLACE FUNCTION app.require_deposit_slip_to_confirm()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'CONFIRMED' AND OLD.state IS DISTINCT FROM 'CONFIRMED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.documents d
      WHERE d.tenant_id = NEW.tenant_id
        AND d.subject_type = 'BANK_DEPOSIT'
        AND d.subject_id = NEW.id
        AND d.kind = 'DEPOSIT_SLIP'
    ) THEN
      RAISE EXCEPTION 'a bank deposit needs a deposit slip before it can be confirmed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS bank_deposits_require_slip_to_confirm ON app.bank_deposits;
--> statement-breakpoint
CREATE TRIGGER bank_deposits_require_slip_to_confirm
  BEFORE UPDATE ON app.bank_deposits
  FOR EACH ROW EXECUTE FUNCTION app.require_deposit_slip_to_confirm();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_meter_boundary_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'meter boundaries are append-only history';
  END IF;
  IF NEW.price_change_id IS DISTINCT FROM OLD.price_change_id AND OLD.price_change_id IS NOT NULL THEN
    RAISE EXCEPTION 'meter boundaries are append-only history';
  END IF;
  IF to_jsonb(NEW) - 'price_change_id' IS DISTINCT FROM to_jsonb(OLD) - 'price_change_id' THEN
    RAISE EXCEPTION 'meter boundaries are append-only history';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS meter_boundaries_history_guard ON app.meter_boundaries;
--> statement-breakpoint
CREATE TRIGGER meter_boundaries_history_guard
  BEFORE UPDATE OR DELETE ON app.meter_boundaries
  FOR EACH ROW EXECUTE FUNCTION app.guard_meter_boundary_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_shift_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.station_id IS DISTINCT FROM OLD.station_id
    OR NEW.business_day_id IS DISTINCT FROM OLD.business_day_id
    OR NEW.business_date IS DISTINCT FROM OLD.business_date
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a shift cannot be moved to another station, business day or date';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS shifts_identity_guard ON app.shifts;
--> statement-breakpoint
CREATE TRIGGER shifts_identity_guard
  BEFORE UPDATE ON app.shifts
  FOR EACH ROW EXECUTE FUNCTION app.guard_shift_identity();
