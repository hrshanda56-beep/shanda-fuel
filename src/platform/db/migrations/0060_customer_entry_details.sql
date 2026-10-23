-- S13: the supporting details of one credit/prepaid account transaction:
-- vehicle registration, driver, voucher/slip number, who approved it and an
-- optional supporting document. Kept beside the ledger (not on it) so the
-- append-only ledger rows are never touched; one row per ledger entry, written
-- once. Voucher numbers are deliberately NOT unique (open owner decision).
CREATE TABLE "app"."customer_ledger_entry_details" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "ledger_entry_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "vehicle_registration" text,
  "driver_name" text,
  "voucher_number" text,
  "approved_by_membership_id" uuid,
  "document_id" uuid,
  "recorded_by" uuid NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_ledger_entry_details_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "customer_ledger_entry_details_entry_uidx" UNIQUE("tenant_id", "ledger_entry_id"),
  CONSTRAINT "customer_ledger_entry_details_vehicle_ck" CHECK ("vehicle_registration" IS NULL OR (btrim("vehicle_registration") <> '' AND char_length("vehicle_registration") <= 20)),
  CONSTRAINT "customer_ledger_entry_details_driver_ck" CHECK ("driver_name" IS NULL OR (btrim("driver_name") <> '' AND char_length("driver_name") <= 120)),
  CONSTRAINT "customer_ledger_entry_details_voucher_ck" CHECK ("voucher_number" IS NULL OR (btrim("voucher_number") <> '' AND char_length("voucher_number") <= 60)),
  CONSTRAINT "customer_ledger_entry_details_something_ck" CHECK (
    "vehicle_registration" IS NOT NULL OR "driver_name" IS NOT NULL OR "voucher_number" IS NOT NULL
    OR "approved_by_membership_id" IS NOT NULL OR "document_id" IS NOT NULL
  )
);
--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entry_details" ADD CONSTRAINT "customer_ledger_entry_details_entry_fk"
  FOREIGN KEY ("tenant_id", "ledger_entry_id") REFERENCES "app"."customer_ledger_entries"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entry_details" ADD CONSTRAINT "customer_ledger_entry_details_account_fk"
  FOREIGN KEY ("tenant_id", "account_id") REFERENCES "app"."customer_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entry_details" ADD CONSTRAINT "customer_ledger_entry_details_approver_fk"
  FOREIGN KEY ("tenant_id", "approved_by_membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entry_details" ADD CONSTRAINT "customer_ledger_entry_details_recorded_by_fk"
  FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entry_details" ADD CONSTRAINT "customer_ledger_entry_details_document_fk"
  FOREIGN KEY ("tenant_id", "document_id") REFERENCES "app"."documents"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_ledger_entry_details_account_idx"
  ON "app"."customer_ledger_entry_details" USING btree ("tenant_id", "account_id");
--> statement-breakpoint
CREATE FUNCTION app.customer_entry_details_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'customer entry details are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_ledger_entry_details_append_only
BEFORE UPDATE OR DELETE ON app.customer_ledger_entry_details
FOR EACH ROW EXECUTE FUNCTION app.customer_entry_details_append_only();
--> statement-breakpoint
ALTER TABLE app.customer_ledger_entry_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customer_ledger_entry_details FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_ledger_entry_details_tenant_context ON app.customer_ledger_entry_details
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.customer_ledger_entry_details OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.customer_ledger_entry_details TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.customer_ledger_entry_details FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.customer_ledger_entry_details TO diagnostics_readonly;
  END IF;
END
$$;
