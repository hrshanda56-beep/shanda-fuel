-- The balance a bank account really holds, as read from the bank statement on a given date.
-- Cash deposits recorded by the app say what went in during a period; they are a flow, not a
-- balance, so the financial position needs this. Append-only: a correction is a new row for the
-- same date, and the latest row recorded for the latest date is the balance that counts.
CREATE TABLE "app"."bank_account_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "as_of_date" date NOT NULL,
  "amount" numeric(20, 4) NOT NULL,
  "note" text,
  "recorded_by" uuid NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bank_account_balances_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "bank_account_balances_note_ck" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "app"."bank_account_balances" ADD CONSTRAINT "bank_account_balances_account_fk"
  FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "app"."bank_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_account_balances" ADD CONSTRAINT "bank_account_balances_recorded_by_fk"
  FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bank_account_balances_latest_idx"
  ON "app"."bank_account_balances" USING btree ("tenant_id", "bank_account_id", "as_of_date" DESC, "recorded_at" DESC);
--> statement-breakpoint
CREATE FUNCTION app.bank_account_balances_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'bank account balances are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_account_balances_append_only
BEFORE UPDATE OR DELETE ON app.bank_account_balances
FOR EACH ROW EXECUTE FUNCTION app.bank_account_balances_append_only();
--> statement-breakpoint
ALTER TABLE app.bank_account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bank_account_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_account_balances_tenant_context ON app.bank_account_balances
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.bank_account_balances OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.bank_account_balances TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.bank_account_balances FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.bank_account_balances TO diagnostics_readonly;
  END IF;
END
$$;
