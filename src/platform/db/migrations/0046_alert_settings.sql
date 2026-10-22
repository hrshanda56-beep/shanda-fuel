CREATE TABLE "app"."alert_settings" (
  "tenant_id" uuid PRIMARY KEY NOT NULL,
  "due_soon_days" integer DEFAULT 7 NOT NULL,
  "pos_settlement_lag_days" integer DEFAULT 3 NOT NULL,
  "report_grace_days" integer DEFAULT 1 NOT NULL,
  "cash_shortage_minimum" numeric(20, 4) DEFAULT 0.01 NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "alert_settings_due_soon_ck" CHECK ("due_soon_days" BETWEEN 1 AND 60),
  CONSTRAINT "alert_settings_pos_lag_ck" CHECK ("pos_settlement_lag_days" BETWEEN 0 AND 30),
  CONSTRAINT "alert_settings_report_grace_ck" CHECK ("report_grace_days" BETWEEN 0 AND 14),
  CONSTRAINT "alert_settings_cash_minimum_ck" CHECK ("cash_shortage_minimum" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."alert_settings" ADD CONSTRAINT "alert_settings_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."alert_settings" ADD CONSTRAINT "alert_settings_updated_by_fk"
  FOREIGN KEY ("tenant_id", "updated_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE app.alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_settings_tenant_context ON app.alert_settings
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.alert_settings OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.alert_settings TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.alert_settings FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.alert_settings TO diagnostics_readonly;
  END IF;
END
$$;
