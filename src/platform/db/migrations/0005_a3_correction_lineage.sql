ALTER TABLE "app"."meter_segments" ADD COLUMN "correction_of_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD COLUMN "reversal_of_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "source_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "correction_of_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_tenant_station_id_uidx" UNIQUE("tenant_id","station_id","id");
--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_correction_of_fk" FOREIGN KEY ("tenant_id", "station_id", "correction_of_segment_id") REFERENCES "app"."meter_segments"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."meter_segments" ADD CONSTRAINT "meter_segments_reversal_of_fk" FOREIGN KEY ("tenant_id", "station_id", "reversal_of_segment_id") REFERENCES "app"."meter_segments"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_source_revision_fk" FOREIGN KEY ("tenant_id", "station_id", "source_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_correction_of_fk" FOREIGN KEY ("tenant_id", "station_id", "correction_of_revision_id") REFERENCES "app"."reconciliation_revisions"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;

-- Final closure: business-day locking is a distinct step-up permission, and
-- stateful workflow rows can only enter through their legal initial state.
INSERT INTO platform.permission_definitions (code, description)
VALUES ('business_day.lock', 'Lock a closed station business day')
ON CONFLICT (code) DO NOTHING;
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'business_day.lock'),
  ('ADMINISTRATOR', 'business_day.lock'),
  ('FINANCE', 'business_day.lock')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.enforce_forecourt_initial_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'station_business_days' AND NEW.state <> 'NOT_STARTED' THEN
    RAISE EXCEPTION 'station business days must be inserted as NOT_STARTED';
  ELSIF TG_TABLE_NAME = 'shifts' AND NEW.state <> 'PLANNED' THEN
    RAISE EXCEPTION 'shifts must be inserted as PLANNED';
  ELSIF TG_TABLE_NAME = 'reconciliations' AND NEW.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'reconciliations must be inserted as DRAFT';
  ELSIF TG_TABLE_NAME = 'reconciliation_revisions' AND NEW.state <> 'READY' THEN
    RAISE EXCEPTION 'reconciliation revisions must be inserted as READY';
  ELSIF TG_TABLE_NAME = 'selling_prices' AND NEW.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'selling prices must be inserted as DRAFT';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER station_business_days_initial_state_guard
BEFORE INSERT ON app.station_business_days FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER shifts_initial_state_guard
BEFORE INSERT ON app.shifts FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER reconciliations_initial_state_guard
BEFORE INSERT ON app.reconciliations FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER reconciliation_revisions_initial_state_guard
BEFORE INSERT ON app.reconciliation_revisions FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
CREATE TRIGGER selling_prices_initial_state_guard
BEFORE INSERT ON app.selling_prices FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_initial_state();
