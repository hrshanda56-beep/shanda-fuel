-- S13: management override of a customer credit limit. Every change keeps the
-- previous and new limit, who approved it and why. Append-only history; the
-- account's current limit is still `customer_accounts.credit_limit`, changed in
-- the same transaction. Permission: customer.limit.override (catalogued in 0008).
CREATE TABLE "app"."customer_credit_limit_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "previous_limit" numeric(20, 4) NOT NULL,
  "new_limit" numeric(20, 4) NOT NULL,
  "approved_by_membership_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "recorded_by" uuid NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_credit_limit_overrides_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "customer_credit_limit_overrides_limits_ck" CHECK ("previous_limit" >= 0 AND "new_limit" > 0 AND "new_limit" <> "previous_limit"),
  CONSTRAINT "customer_credit_limit_overrides_reason_ck" CHECK (btrim("reason") <> '' AND char_length("reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "app"."customer_credit_limit_overrides" ADD CONSTRAINT "customer_credit_limit_overrides_account_fk"
  FOREIGN KEY ("tenant_id", "account_id") REFERENCES "app"."customer_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_credit_limit_overrides" ADD CONSTRAINT "customer_credit_limit_overrides_approver_fk"
  FOREIGN KEY ("tenant_id", "approved_by_membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_credit_limit_overrides" ADD CONSTRAINT "customer_credit_limit_overrides_recorded_by_fk"
  FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_credit_limit_overrides_account_idx"
  ON "app"."customer_credit_limit_overrides" USING btree ("tenant_id", "account_id", "recorded_at");
--> statement-breakpoint
CREATE FUNCTION app.customer_limit_overrides_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'credit limit override history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_credit_limit_overrides_append_only
BEFORE UPDATE OR DELETE ON app.customer_credit_limit_overrides
FOR EACH ROW EXECUTE FUNCTION app.customer_limit_overrides_append_only();
--> statement-breakpoint
ALTER TABLE app.customer_credit_limit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customer_credit_limit_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_credit_limit_overrides_tenant_context ON app.customer_credit_limit_overrides
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.customer_credit_limit_overrides OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.customer_credit_limit_overrides TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.customer_credit_limit_overrides FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.customer_credit_limit_overrides TO diagnostics_readonly;
  END IF;
END
$$;
