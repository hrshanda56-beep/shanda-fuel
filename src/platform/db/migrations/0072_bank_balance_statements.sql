-- Bank balances typed in from the bank statement. Append-only: a correction is a new line, and the
-- latest line for an account is the one shown. Deposits recorded in the app stay as they are; this
-- only adds the balance the bank itself reports.
CREATE TABLE "app"."bank_balance_statements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "as_of_date" date NOT NULL,
  "balance" numeric(20, 4) NOT NULL,
  "note" text,
  "entered_by" uuid NOT NULL,
  "entered_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bank_balance_statements_tenant_id_id_uidx" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "bank_balance_statements_note_ck" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "app"."bank_balance_statements" ADD CONSTRAINT "bank_balance_statements_account_fk"
  FOREIGN KEY ("tenant_id", "bank_account_id")
  REFERENCES "app"."bank_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_balance_statements" ADD CONSTRAINT "bank_balance_statements_entered_by_fk"
  FOREIGN KEY ("tenant_id", "entered_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bank_balance_statements_latest_idx"
  ON "app"."bank_balance_statements" ("tenant_id", "bank_account_id", "as_of_date" DESC, "entered_at" DESC);
--> statement-breakpoint
ALTER TABLE app.bank_balance_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bank_balance_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_balance_statements_tenant_context ON app.bank_balance_statements
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.bank_balance_statements OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.bank_balance_statements TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.bank_balance_statements FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.bank_balance_statements TO diagnostics_readonly;
  END IF;
END
$$;
