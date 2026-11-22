-- Past-day entry: figures for days that already happened (history at go-live, or days nobody closed).
-- Additive only. Existing columns, row-level security policies, grants and audit triggers on both tables
-- already cover the new nullable/defaulted columns, so nothing else changes. Nothing is backfilled:
-- every existing business day stays "not entered late". Local development databases until approved.

-- The first business date the station records in this system. Past days are accepted only on or after it.
ALTER TABLE "app"."stations"
  ADD COLUMN "go_live_date" text;
--> statement-breakpoint
ALTER TABLE "app"."stations"
  ADD CONSTRAINT "stations_go_live_date_ck" CHECK (
    "go_live_date" IS NULL OR "go_live_date" ~ '^\d{4}-\d{2}-\d{2}$'
  );
--> statement-breakpoint
-- A business day recorded after the day itself is marked, with who recorded it and when.
ALTER TABLE "app"."station_business_days"
  ADD COLUMN "entered_late" boolean NOT NULL DEFAULT false,
  ADD COLUMN "entered_late_by" uuid,
  ADD COLUMN "entered_late_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."station_business_days"
  ADD CONSTRAINT "station_business_days_entered_late_ck" CHECK (
    ("entered_late" = false AND "entered_late_by" IS NULL AND "entered_late_at" IS NULL)
    OR ("entered_late" = true AND "entered_late_by" IS NOT NULL AND "entered_late_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "station_business_days_entered_late_by_fk"
    FOREIGN KEY ("tenant_id", "entered_late_by") REFERENCES "app"."memberships"("tenant_id", "id");
