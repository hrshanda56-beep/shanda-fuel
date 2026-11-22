-- ZERA monthly return (#258): every return a person saves is kept as it was on the day, so a later
-- correction to a delivery or a report cannot quietly change a return that has already gone to the
-- regulator. A correction is saved as a new version; earlier versions stay. The app role can read and
-- add rows but never change or remove one. Local development databases until approved.

CREATE TABLE "app"."zera_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "station_id" uuid NOT NULL,
  "month" text NOT NULL,
  "version" integer NOT NULL,
  -- The fourteen answers exactly as shown and copied: [{ "label": "...", "value": "..." }].
  "answers" jsonb NOT NULL,
  -- The worked-out figures and the reasons behind them (m days, notes), for the record.
  "figures" jsonb NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "zera_returns_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "zera_returns_version_uidx" UNIQUE ("tenant_id", "station_id", "month", "version"),
  CONSTRAINT "zera_returns_month_ck" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "zera_returns_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "zera_returns_answers_ck" CHECK (jsonb_typeof("answers") = 'array' AND jsonb_array_length("answers") = 14)
);
--> statement-breakpoint
ALTER TABLE "app"."zera_returns" ADD CONSTRAINT "zera_returns_station_fk"
  FOREIGN KEY ("tenant_id", "station_id")
  REFERENCES "app"."stations"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."zera_returns" ADD CONSTRAINT "zera_returns_created_by_fk"
  FOREIGN KEY ("tenant_id", "created_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "zera_returns_station_idx"
  ON "app"."zera_returns" ("tenant_id", "station_id", "month", "version" DESC);
--> statement-breakpoint
ALTER TABLE app.zera_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.zera_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY zera_returns_tenant_context ON app.zera_returns
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.zera_returns OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.zera_returns TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.zera_returns FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.zera_returns TO diagnostics_readonly;
  END IF;
END
$$;
