-- Go-live opening balances: a tenant-scoped CSV staging batch which is reviewed,
-- approved, then posted and locked atomically. Draft rows never affect a ledger.
CREATE TABLE "app"."opening_balance_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "as_of_date" text NOT NULL,
  "source_filename" text,
  "source_hash" text NOT NULL,
  "state" text DEFAULT 'DRAFT' NOT NULL,
  "line_count" integer NOT NULL,
  "created_by" uuid NOT NULL,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "locked_by" uuid,
  "locked_at" timestamp with time zone,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "opening_balance_batches_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "opening_balance_batches_tenant_hash_uidx" UNIQUE("tenant_id", "source_hash"),
  CONSTRAINT "opening_balance_batches_state_ck" CHECK ("state" in ('DRAFT','APPROVED','LOCKED')),
  CONSTRAINT "opening_balance_batches_line_count_ck" CHECK ("line_count" > 0),
  CONSTRAINT "opening_balance_batches_hash_ck" CHECK (btrim("source_hash") <> '')
);
--> statement-breakpoint
CREATE TABLE "app"."opening_balance_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "line_number" integer NOT NULL,
  "line_key" text NOT NULL,
  "line_type" text NOT NULL,
  "legal_entity_id" uuid,
  "station_id" uuid,
  "supplier_id" uuid,
  "customer_id" uuid,
  "account_id" uuid,
  "cash_location_id" uuid,
  "bank_account_id" uuid,
  "tank_id" uuid,
  "product_id" uuid,
  "reference" text,
  "effective_date" text NOT NULL,
  "due_date" text,
  "amount" numeric(20, 4),
  "quantity_litres" numeric(18, 3),
  "inventory_value" numeric(20, 4),
  "currency" text DEFAULT 'USD' NOT NULL,
  "notes" text,
  "raw_row" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "opening_balance_lines_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "opening_balance_lines_batch_line_number_uidx" UNIQUE("tenant_id", "batch_id", "line_number"),
  CONSTRAINT "opening_balance_lines_batch_line_key_uidx" UNIQUE("tenant_id", "batch_id", "line_key"),
  CONSTRAINT "opening_balance_lines_type_ck" CHECK ("line_type" in ('SUPPLIER_INVOICE','CUSTOMER_CHARGE','CASH_BALANCE','BANK_BALANCE','TANK_STOCK')),
  CONSTRAINT "opening_balance_lines_currency_ck" CHECK ("currency" = 'USD'),
  CONSTRAINT "opening_balance_lines_amount_ck" CHECK ("amount" is null or "amount" >= 0),
  CONSTRAINT "opening_balance_lines_quantity_ck" CHECK ("quantity_litres" is null or "quantity_litres" > 0),
  CONSTRAINT "opening_balance_lines_inventory_value_ck" CHECK ("inventory_value" is null or "inventory_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bank_opening_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "amount" numeric(20, 4) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "effective_date" text NOT NULL,
  "source_batch_id" uuid NOT NULL,
  "source_line_id" uuid NOT NULL,
  "actor_membership_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bank_opening_balances_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "bank_opening_balances_account_uidx" UNIQUE("tenant_id", "bank_account_id"),
  CONSTRAINT "bank_opening_balances_source_line_uidx" UNIQUE("tenant_id", "source_line_id"),
  CONSTRAINT "bank_opening_balances_amount_ck" CHECK ("amount" >= 0),
  CONSTRAINT "bank_opening_balances_currency_ck" CHECK ("currency" = 'USD')
);
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_tenant_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_created_by_fk"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_approved_by_fk"
  FOREIGN KEY ("tenant_id", "approved_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_locked_by_fk"
  FOREIGN KEY ("tenant_id", "locked_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_batch_fk"
  FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "app"."opening_balance_batches"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_legal_entity_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_station_fk"
  FOREIGN KEY ("tenant_id", "station_id") REFERENCES "app"."stations"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_supplier_fk"
  FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "app"."suppliers"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_customer_fk"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "app"."customers"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_account_fk"
  FOREIGN KEY ("tenant_id", "account_id") REFERENCES "app"."customer_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_cash_location_fk"
  FOREIGN KEY ("tenant_id", "station_id", "cash_location_id") REFERENCES "app"."cash_locations"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_bank_account_fk"
  FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "app"."bank_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_tank_fk"
  FOREIGN KEY ("tenant_id", "station_id", "tank_id") REFERENCES "app"."tanks"("tenant_id", "station_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_product_fk"
  FOREIGN KEY ("tenant_id", "product_id") REFERENCES "app"."products"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_opening_balances" ADD CONSTRAINT "bank_opening_balances_legal_entity_fk"
  FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_opening_balances" ADD CONSTRAINT "bank_opening_balances_account_fk"
  FOREIGN KEY ("tenant_id", "bank_account_id") REFERENCES "app"."bank_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_opening_balances" ADD CONSTRAINT "bank_opening_balances_batch_fk"
  FOREIGN KEY ("tenant_id", "source_batch_id") REFERENCES "app"."opening_balance_batches"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_opening_balances" ADD CONSTRAINT "bank_opening_balances_line_fk"
  FOREIGN KEY ("tenant_id", "source_line_id") REFERENCES "app"."opening_balance_lines"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."bank_opening_balances" ADD CONSTRAINT "bank_opening_balances_actor_fk"
  FOREIGN KEY ("tenant_id", "actor_membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "opening_balance_batches_tenant_state_idx" ON "app"."opening_balance_batches" ("tenant_id", "state");
--> statement-breakpoint
CREATE INDEX "opening_balance_lines_batch_idx" ON "app"."opening_balance_lines" ("tenant_id", "batch_id", "line_number");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.opening_balance_line_shape_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.line_type = 'SUPPLIER_INVOICE' AND (NEW.legal_entity_id IS NULL OR NEW.supplier_id IS NULL OR NEW.reference IS NULL OR btrim(NEW.reference) = '' OR NEW.amount IS NULL OR NEW.amount <= 0) THEN
    RAISE EXCEPTION 'supplier opening invoice requires company, supplier, reference and positive amount';
  ELSIF NEW.line_type = 'CUSTOMER_CHARGE' AND (NEW.customer_id IS NULL OR NEW.account_id IS NULL OR NEW.amount IS NULL OR NEW.amount <= 0) THEN
    RAISE EXCEPTION 'customer opening charge requires customer, account and positive amount';
  ELSIF NEW.line_type = 'CASH_BALANCE' AND (NEW.station_id IS NULL OR NEW.cash_location_id IS NULL OR NEW.amount IS NULL OR NEW.amount <= 0) THEN
    RAISE EXCEPTION 'cash opening balance requires station, cash location and positive amount';
  ELSIF NEW.line_type = 'BANK_BALANCE' AND (NEW.legal_entity_id IS NULL OR NEW.bank_account_id IS NULL OR NEW.amount IS NULL OR NEW.amount < 0) THEN
    RAISE EXCEPTION 'bank opening balance requires company, bank account and non-negative amount';
  ELSIF NEW.line_type = 'TANK_STOCK' AND (NEW.station_id IS NULL OR NEW.tank_id IS NULL OR NEW.product_id IS NULL OR NEW.quantity_litres IS NULL OR NEW.quantity_litres <= 0) THEN
    RAISE EXCEPTION 'tank opening stock requires station, tank and positive litres';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opening_balance_line_shape_guard
BEFORE INSERT OR UPDATE ON app.opening_balance_lines
FOR EACH ROW EXECUTE FUNCTION app.opening_balance_line_shape_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.opening_balance_batch_state_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.as_of_date IS DISTINCT FROM OLD.as_of_date OR NEW.source_filename IS DISTINCT FROM OLD.source_filename OR NEW.source_hash IS DISTINCT FROM OLD.source_hash OR NEW.line_count IS DISTINCT FROM OLD.line_count OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'opening balance batch identity is immutable';
  END IF;
  IF OLD.state = 'LOCKED' THEN
    IF NEW.state <> OLD.state OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.locked_by IS DISTINCT FROM OLD.locked_by OR NEW.locked_at IS DISTINCT FROM OLD.locked_at OR NEW.version IS DISTINCT FROM OLD.version OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
      RAISE EXCEPTION 'locked opening balance batches are immutable';
    END IF;
  ELSIF OLD.state = 'DRAFT' THEN
    IF NEW.state <> 'APPROVED' OR NEW.version <> OLD.version + 1 OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.locked_by IS NOT NULL OR NEW.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'draft opening balance batches must transition once to approved';
    END IF;
  ELSIF OLD.state = 'APPROVED' THEN
    IF NEW.state <> 'LOCKED' OR NEW.version <> OLD.version + 1 OR NEW.locked_by IS NULL OR NEW.locked_at IS NULL THEN
      RAISE EXCEPTION 'approved opening balance batches must transition once to locked';
    END IF;
  END IF;
  IF OLD.state = 'APPROVED' AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'approved opening balance provenance is immutable';
  END IF;
  IF NEW.state = 'APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'approved opening balance batches require approval provenance';
  END IF;
  IF NEW.state = 'LOCKED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.locked_by IS NULL OR NEW.locked_at IS NULL) THEN
    RAISE EXCEPTION 'locked opening balance batches require approval and lock provenance';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opening_balance_batch_state_guard
BEFORE UPDATE ON app.opening_balance_batches
FOR EACH ROW EXECUTE FUNCTION app.opening_balance_batch_state_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.opening_balance_lines_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'opening balance lines are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opening_balance_lines_append_only
BEFORE UPDATE OR DELETE ON app.opening_balance_lines
FOR EACH ROW EXECUTE FUNCTION app.opening_balance_lines_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.bank_opening_balances_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'bank opening balances are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_opening_balances_append_only
BEFORE UPDATE OR DELETE ON app.bank_opening_balances
FOR EACH ROW EXECUTE FUNCTION app.bank_opening_balances_append_only();
--> statement-breakpoint
ALTER TABLE app.opening_balance_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.opening_balance_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY opening_balance_batches_tenant_context ON app.opening_balance_batches
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
ALTER TABLE app.opening_balance_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.opening_balance_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY opening_balance_lines_tenant_context ON app.opening_balance_lines
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
ALTER TABLE app.bank_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bank_opening_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY bank_opening_balances_tenant_context ON app.bank_opening_balances
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
ALTER TABLE app.customer_ledger_entries DROP CONSTRAINT customer_ledger_entries_source_type_ck;
ALTER TABLE app.customer_ledger_entries ADD CONSTRAINT customer_ledger_entries_source_type_ck CHECK (source_type in ('A5_RECONCILIATION_CUSTOMER_FUEL','CUSTOMER_PAYMENT','PREPAID_TOPUP','MANUAL_ADJUSTMENT','OPENING_BALANCE','LEDGER_REVERSAL'));
--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description)
VALUES ('finance.opening_balance.manage', 'Import, approve and lock go-live opening balances')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('OWNER', 'finance.opening_balance.manage'), ('ADMINISTRATOR', 'finance.opening_balance.manage'), ('FINANCE', 'finance.opening_balance.manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.opening_balance_batches OWNER TO migration_owner;
    ALTER TABLE app.opening_balance_lines OWNER TO migration_owner;
    ALTER TABLE app.bank_opening_balances OWNER TO migration_owner;
    ALTER FUNCTION app.opening_balance_line_shape_guard() OWNER TO migration_owner;
    ALTER FUNCTION app.opening_balance_batch_state_guard() OWNER TO migration_owner;
    ALTER FUNCTION app.opening_balance_lines_append_only() OWNER TO migration_owner;
    ALTER FUNCTION app.bank_opening_balances_append_only() OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.opening_balance_batches TO app_runtime;
    REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.opening_balance_batches FROM app_runtime;
    GRANT SELECT, INSERT ON app.opening_balance_lines TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.opening_balance_lines FROM app_runtime;
    GRANT SELECT, INSERT ON app.bank_opening_balances TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.bank_opening_balances FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.opening_balance_batches, app.opening_balance_lines, app.bank_opening_balances TO diagnostics_readonly;
  END IF;
END
$$;
