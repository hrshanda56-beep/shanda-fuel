CREATE TABLE "app"."customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"credit_limit" numeric(20, 4),
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_accounts_type_ck" CHECK ("app"."customer_accounts"."account_type" in ('CREDIT','PREPAID_VALUE','PREPAID_LITRES')),
	CONSTRAINT "customer_accounts_currency_ck" CHECK ("app"."customer_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customer_accounts_status_ck" CHECK ("app"."customer_accounts"."status" in ('ACTIVE','SUSPENDED','CLOSED')),
	CONSTRAINT "customer_accounts_credit_limit_ck" CHECK ("app"."customer_accounts"."credit_limit" is null or ("app"."customer_accounts"."account_type" = 'CREDIT' and "app"."customer_accounts"."credit_limit" >= 0))
);
--> statement-breakpoint
CREATE TABLE "app"."customer_fuel_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"product_id" uuid NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"requested_amount" numeric(20, 4) NOT NULL,
	"requested_litres" numeric(18, 3) NOT NULL,
	"used_amount" numeric(20, 4) DEFAULT '0' NOT NULL,
	"used_litres" numeric(18, 3) DEFAULT '0' NOT NULL,
	"remaining_amount" numeric(20, 4) NOT NULL,
	"remaining_litres" numeric(18, 3) NOT NULL,
	"state" text DEFAULT 'REQUESTED' NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision_id" uuid,
	"source_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_fuel_authorizations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_fuel_authorizations_source_key_uidx" UNIQUE("tenant_id","source_key"),
	CONSTRAINT "customer_fuel_authorizations_type_ck" CHECK ("app"."customer_fuel_authorizations"."account_type" in ('CREDIT','PREPAID_VALUE','PREPAID_LITRES')),
	CONSTRAINT "customer_fuel_authorizations_currency_ck" CHECK ("app"."customer_fuel_authorizations"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customer_fuel_authorizations_state_ck" CHECK ("app"."customer_fuel_authorizations"."state" in ('REQUESTED','AUTHORIZED','PARTIALLY_USED','COMPLETED','CANCELLED','EXPIRED','REJECTED')),
	CONSTRAINT "customer_fuel_authorizations_amounts_ck" CHECK ("app"."customer_fuel_authorizations"."requested_amount" > 0 and "app"."customer_fuel_authorizations"."requested_litres" > 0 and "app"."customer_fuel_authorizations"."used_amount" >= 0 and "app"."customer_fuel_authorizations"."used_litres" >= 0 and "app"."customer_fuel_authorizations"."remaining_amount" >= 0 and "app"."customer_fuel_authorizations"."remaining_litres" >= 0),
	CONSTRAINT "customer_fuel_authorizations_totals_ck" CHECK ("app"."customer_fuel_authorizations"."requested_amount" = "app"."customer_fuel_authorizations"."used_amount" + "app"."customer_fuel_authorizations"."remaining_amount" and "app"."customer_fuel_authorizations"."requested_litres" = "app"."customer_fuel_authorizations"."used_litres" + "app"."customer_fuel_authorizations"."remaining_litres")
);
--> statement-breakpoint
CREATE TABLE "app"."customer_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"entry_type" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(20, 4),
	"product_id" uuid,
	"quantity_litres" numeric(18, 3),
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision_id" uuid,
	"source_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"business_date" text NOT NULL,
	"note" text,
	"reason" text,
	"fuel_allocation_id" uuid,
	"reversal_of_entry_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_ledger_entries_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_ledger_entries_source_key_uidx" UNIQUE("tenant_id","account_id","source_key"),
	CONSTRAINT "customer_ledger_entries_type_ck" CHECK ("app"."customer_ledger_entries"."account_type" in ('CREDIT','PREPAID_VALUE','PREPAID_LITRES')),
	CONSTRAINT "customer_ledger_entries_entry_type_ck" CHECK ("app"."customer_ledger_entries"."entry_type" in ('CREDIT_FUEL_CHARGE','CUSTOMER_PAYMENT','PREPAID_TOPUP','PREPAID_FUEL_USAGE','ADJUSTMENT','REVERSAL')),
	CONSTRAINT "customer_ledger_entries_direction_ck" CHECK ("app"."customer_ledger_entries"."direction" in ('INCREASE','DECREASE')),
	CONSTRAINT "customer_ledger_entries_source_type_ck" CHECK ("app"."customer_ledger_entries"."source_type" in ('A5_RECONCILIATION_CUSTOMER_FUEL','CUSTOMER_PAYMENT','PREPAID_TOPUP','MANUAL_ADJUSTMENT','LEDGER_REVERSAL')),
	CONSTRAINT "customer_ledger_entries_value_shape_ck" CHECK ((
      ("app"."customer_ledger_entries"."account_type" in ('CREDIT','PREPAID_VALUE') and "app"."customer_ledger_entries"."amount" > 0 and "app"."customer_ledger_entries"."quantity_litres" is null and ("app"."customer_ledger_entries"."product_id" is null or "app"."customer_ledger_entries"."account_type" = 'CREDIT'))
      or ("app"."customer_ledger_entries"."account_type" = 'PREPAID_LITRES' and "app"."customer_ledger_entries"."amount" is null and "app"."customer_ledger_entries"."quantity_litres" > 0 and "app"."customer_ledger_entries"."product_id" is not null)
    )),
	CONSTRAINT "customer_ledger_entries_entry_account_ck" CHECK ((
      ("app"."customer_ledger_entries"."account_type" = 'CREDIT' and "app"."customer_ledger_entries"."entry_type" in ('CREDIT_FUEL_CHARGE','CUSTOMER_PAYMENT','ADJUSTMENT','REVERSAL'))
      or ("app"."customer_ledger_entries"."account_type" = 'PREPAID_VALUE' and "app"."customer_ledger_entries"."entry_type" in ('PREPAID_TOPUP','PREPAID_FUEL_USAGE','ADJUSTMENT','REVERSAL'))
      or ("app"."customer_ledger_entries"."account_type" = 'PREPAID_LITRES' and "app"."customer_ledger_entries"."entry_type" in ('PREPAID_TOPUP','PREPAID_FUEL_USAGE','ADJUSTMENT','REVERSAL'))
    ))
);
--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_reference" text NOT NULL,
	"display_name" text NOT NULL,
	"contact_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_tenant_reference_uidx" UNIQUE("tenant_id","account_reference"),
	CONSTRAINT "customers_reference_nonempty_ck" CHECK (btrim("app"."customers"."account_reference") <> ''),
	CONSTRAINT "customers_name_nonempty_ck" CHECK (btrim("app"."customers"."display_name") <> ''),
	CONSTRAINT "customers_status_ck" CHECK ("app"."customers"."status" in ('ACTIVE','SUSPENDED','CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "app"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_fuel_authorizations" ADD CONSTRAINT "customer_fuel_authorizations_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "app"."customer_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_fuel_authorizations" ADD CONSTRAINT "customer_fuel_authorizations_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_fuel_authorizations" ADD CONSTRAINT "customer_fuel_authorizations_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "app"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_fuel_authorizations" ADD CONSTRAINT "customer_fuel_authorizations_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "app"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "app"."customer_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customers" ADD CONSTRAINT "customers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customers" ADD CONSTRAINT "customers_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customers" ADD CONSTRAINT "customers_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_accounts_tenant_customer_status_idx" ON "app"."customer_accounts" USING btree ("tenant_id","customer_id","status");--> statement-breakpoint
CREATE INDEX "customer_fuel_authorizations_account_state_idx" ON "app"."customer_fuel_authorizations" USING btree ("tenant_id","account_id","state");--> statement-breakpoint
CREATE INDEX "customer_fuel_authorizations_station_state_idx" ON "app"."customer_fuel_authorizations" USING btree ("tenant_id","station_id","state");--> statement-breakpoint
CREATE INDEX "customer_ledger_entries_account_occurred_idx" ON "app"."customer_ledger_entries" USING btree ("tenant_id","account_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "customers_tenant_status_idx" ON "app"."customers" USING btree ("tenant_id","status");

INSERT INTO platform.permission_definitions (code, description) VALUES
  ('customer.view', 'View customer records and account balances'),
  ('customer.manage', 'Create and manage customer records'),
  ('customer.account.manage', 'Open and manage customer accounts'),
  ('customer.credit.authorize', 'Authorize and complete customer fuel usage'),
  ('customer.prepaid.top_up', 'Post prepaid account top-ups'),
  ('customer.payment.record', 'Record customer account payments'),
  ('customer.statement.view', 'View customer account statements'),
  ('customer.account.adjust', 'Post customer account adjustments and reversals'),
  ('customer.limit.override', 'Override a customer credit limit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT role_code, permission_code
FROM (
  VALUES
    ('OWNER', 'customer.view'), ('OWNER', 'customer.manage'), ('OWNER', 'customer.account.manage'),
    ('OWNER', 'customer.credit.authorize'), ('OWNER', 'customer.prepaid.top_up'), ('OWNER', 'customer.payment.record'),
    ('OWNER', 'customer.statement.view'), ('OWNER', 'customer.account.adjust'), ('OWNER', 'customer.limit.override'),
    ('ADMINISTRATOR', 'customer.view'), ('ADMINISTRATOR', 'customer.manage'), ('ADMINISTRATOR', 'customer.account.manage'),
    ('ADMINISTRATOR', 'customer.credit.authorize'), ('ADMINISTRATOR', 'customer.prepaid.top_up'), ('ADMINISTRATOR', 'customer.payment.record'),
    ('ADMINISTRATOR', 'customer.statement.view'), ('ADMINISTRATOR', 'customer.account.adjust'), ('ADMINISTRATOR', 'customer.limit.override'),
    ('FINANCE', 'customer.view'), ('FINANCE', 'customer.manage'), ('FINANCE', 'customer.account.manage'),
    ('FINANCE', 'customer.credit.authorize'), ('FINANCE', 'customer.prepaid.top_up'), ('FINANCE', 'customer.payment.record'),
    ('FINANCE', 'customer.statement.view'), ('FINANCE', 'customer.account.adjust'), ('FINANCE', 'customer.limit.override'),
    ('SUPERVISOR', 'customer.view'), ('SUPERVISOR', 'customer.credit.authorize'), ('SUPERVISOR', 'customer.statement.view')
) AS seed(role_code, permission_code)
ON CONFLICT (role_code, permission_code) DO NOTHING;

CREATE OR REPLACE FUNCTION app.a8_customer_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer ledger entries are append-only; use a named reversal or adjustment';
END;
$$;

CREATE TRIGGER customer_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON app.customer_ledger_entries
FOR EACH ROW EXECUTE FUNCTION app.a8_customer_ledger_append_only();

CREATE OR REPLACE FUNCTION app.a8_customer_authorization_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.station_id IS DISTINCT FROM NEW.station_id
     OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
     OR OLD.account_id IS DISTINCT FROM NEW.account_id
     OR OLD.account_type IS DISTINCT FROM NEW.account_type
     OR OLD.product_id IS DISTINCT FROM NEW.product_id
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.requested_amount IS DISTINCT FROM NEW.requested_amount
     OR OLD.requested_litres IS DISTINCT FROM NEW.requested_litres
     OR OLD.source_type IS DISTINCT FROM NEW.source_type
     OR OLD.source_id IS DISTINCT FROM NEW.source_id
     OR OLD.source_revision_id IS DISTINCT FROM NEW.source_revision_id
     OR OLD.source_key IS DISTINCT FROM NEW.source_key
     OR OLD.requested_by IS DISTINCT FROM NEW.requested_by
     OR OLD.requested_at IS DISTINCT FROM NEW.requested_at THEN
    RAISE EXCEPTION 'customer authorization facts are immutable';
  END IF;
  IF OLD.state = 'REQUESTED' AND NEW.state NOT IN ('REQUESTED','AUTHORIZED','CANCELLED','EXPIRED','REJECTED') THEN
    RAISE EXCEPTION 'requested customer authorization has an invalid transition';
  END IF;
  IF OLD.state = 'AUTHORIZED' AND NEW.state NOT IN ('AUTHORIZED','PARTIALLY_USED','COMPLETED','CANCELLED','EXPIRED') THEN
    RAISE EXCEPTION 'authorized customer authorization has an invalid transition';
  END IF;
  IF OLD.state = 'PARTIALLY_USED' AND NEW.state NOT IN ('PARTIALLY_USED','COMPLETED','CANCELLED','EXPIRED') THEN
    RAISE EXCEPTION 'partially used customer authorization has an invalid transition';
  END IF;
  IF OLD.state IN ('COMPLETED','CANCELLED','EXPIRED','REJECTED') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'terminal customer authorization cannot transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_fuel_authorizations_state_guard
BEFORE UPDATE ON app.customer_fuel_authorizations
FOR EACH ROW EXECUTE FUNCTION app.a8_customer_authorization_guard();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['customers', 'customer_accounts', 'customer_ledger_entries', 'customer_fuel_authorizations'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())',
      table_name || '_tenant_context', table_name
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.customers, app.customer_accounts, app.customer_fuel_authorizations TO app_runtime;
    GRANT SELECT, INSERT ON app.customer_ledger_entries TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.customers, app.customer_accounts, app.customer_ledger_entries, app.customer_fuel_authorizations TO diagnostics_readonly;
  END IF;
END
$$;

REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.customer_ledger_entries FROM app_runtime;

ALTER TABLE "app"."customer_fuel_authorizations" ADD CONSTRAINT "customer_fuel_authorizations_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "app"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;
