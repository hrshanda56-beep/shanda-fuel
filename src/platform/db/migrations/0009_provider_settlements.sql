CREATE TABLE "app"."payment_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_providers_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_providers_tenant_code_uidx" UNIQUE("tenant_id","code"),
	CONSTRAINT "payment_providers_type_ck" CHECK ("app"."payment_providers"."provider_type" in ('CARD_ACQUIRER','POS','MOBILE_MONEY','OTHER_ELECTRONIC')),
	CONSTRAINT "payment_providers_status_ck" CHECK ("app"."payment_providers"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "app"."provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"station_id" uuid,
	"account_reference" text NOT NULL,
	"display_name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_accounts_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "provider_accounts_tenant_provider_reference_uidx" UNIQUE("tenant_id","provider_id","account_reference"),
	CONSTRAINT "provider_accounts_tenant_legal_entity_id_id_uidx" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "provider_accounts_reference_nonempty_ck" CHECK (btrim("app"."provider_accounts"."account_reference") <> ''),
	CONSTRAINT "provider_accounts_currency_ck" CHECK ("app"."provider_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_accounts_status_ck" CHECK ("app"."provider_accounts"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "app"."provider_settlement_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"reconciliation_payment_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"allocation_key" text NOT NULL,
	"state" text DEFAULT 'POSTED' NOT NULL,
	"reversal_of_id" uuid,
	"allocated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_settlement_allocations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "provider_settlement_allocations_key_uidx" UNIQUE("tenant_id","allocation_key"),
	CONSTRAINT "provider_settlement_allocations_amount_ck" CHECK ("app"."provider_settlement_allocations"."amount" > 0),
	CONSTRAINT "provider_settlement_allocations_state_ck" CHECK ("app"."provider_settlement_allocations"."state" in ('POSTED','REVERSED')),
	CONSTRAINT "provider_settlement_allocations_reversal_ck" CHECK (("app"."provider_settlement_allocations"."state" = 'POSTED' and "app"."provider_settlement_allocations"."reversal_of_id" is null) or ("app"."provider_settlement_allocations"."state" = 'REVERSED' and "app"."provider_settlement_allocations"."reversal_of_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."provider_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_account_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"settlement_reference" text NOT NULL,
	"batch_reference" text,
	"transaction_date" text NOT NULL,
	"settlement_date" text NOT NULL,
	"currency" text NOT NULL,
	"gross_amount" numeric(20, 4) NOT NULL,
	"provider_fee_amount" numeric(20, 4),
	"provider_deduction_amount" numeric(20, 4),
	"reported_net_amount" numeric(20, 4),
	"source_type" text NOT NULL,
	"source_key" text NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'RECORDED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"recorded_by" uuid NOT NULL,
	"reconciled_by" uuid,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_settlements_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "provider_settlements_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "provider_settlements_account_reference_uidx" UNIQUE("tenant_id","provider_account_id","settlement_reference"),
	CONSTRAINT "provider_settlements_source_key_uidx" UNIQUE("tenant_id","source_key"),
	CONSTRAINT "provider_settlements_reference_nonempty_ck" CHECK (btrim("app"."provider_settlements"."settlement_reference") <> ''),
	CONSTRAINT "provider_settlements_transaction_date_ck" CHECK ("app"."provider_settlements"."transaction_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "provider_settlements_settlement_date_ck" CHECK ("app"."provider_settlements"."settlement_date" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "provider_settlements_currency_ck" CHECK ("app"."provider_settlements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "provider_settlements_amounts_ck" CHECK ("app"."provider_settlements"."gross_amount" > 0 and coalesce("app"."provider_settlements"."provider_fee_amount", 0) >= 0 and coalesce("app"."provider_settlements"."provider_deduction_amount", 0) >= 0 and coalesce("app"."provider_settlements"."reported_net_amount", 0) >= 0),
	CONSTRAINT "provider_settlements_source_type_ck" CHECK ("app"."provider_settlements"."source_type" in ('MANUAL','PROVIDER_IMPORT')),
	CONSTRAINT "provider_settlements_state_ck" CHECK ("app"."provider_settlements"."state" in ('RECORDED','PARTIALLY_MATCHED','RECONCILED','EXCEPTION'))
);
--> statement-breakpoint
ALTER TABLE "app"."payment_providers" ADD CONSTRAINT "payment_providers_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_providers" ADD CONSTRAINT "payment_providers_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_provider_fk" FOREIGN KEY ("tenant_id","provider_id") REFERENCES "app"."payment_providers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement_allocations" ADD CONSTRAINT "provider_settlement_allocations_settlement_fk" FOREIGN KEY ("tenant_id","station_id","settlement_id") REFERENCES "app"."provider_settlements"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement_allocations" ADD CONSTRAINT "provider_settlement_allocations_payment_fk" FOREIGN KEY ("tenant_id","reconciliation_payment_id") REFERENCES "app"."reconciliation_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement_allocations" ADD CONSTRAINT "provider_settlement_allocations_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement_allocations" ADD CONSTRAINT "provider_settlement_allocations_reversal_fk" FOREIGN KEY ("tenant_id","reversal_of_id") REFERENCES "app"."provider_settlement_allocations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlement_allocations" ADD CONSTRAINT "provider_settlement_allocations_allocated_by_fk" FOREIGN KEY ("tenant_id","allocated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlements" ADD CONSTRAINT "provider_settlements_account_fk" FOREIGN KEY ("tenant_id","provider_account_id") REFERENCES "app"."provider_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlements" ADD CONSTRAINT "provider_settlements_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlements" ADD CONSTRAINT "provider_settlements_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_settlements" ADD CONSTRAINT "provider_settlements_reconciled_by_fk" FOREIGN KEY ("tenant_id","reconciled_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_providers_tenant_status_idx" ON "app"."payment_providers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "provider_accounts_tenant_station_status_idx" ON "app"."provider_accounts" USING btree ("tenant_id","station_id","status");--> statement-breakpoint
CREATE INDEX "provider_settlement_allocations_payment_idx" ON "app"."provider_settlement_allocations" USING btree ("tenant_id","station_id","reconciliation_payment_id","state");--> statement-breakpoint
CREATE INDEX "provider_settlement_allocations_settlement_idx" ON "app"."provider_settlement_allocations" USING btree ("tenant_id","station_id","settlement_id","state");--> statement-breakpoint
CREATE INDEX "provider_settlements_station_date_state_idx" ON "app"."provider_settlements" USING btree ("tenant_id","station_id","settlement_date","state");
--> statement-breakpoint

INSERT INTO platform.permission_definitions (code, description) VALUES
  ('provider.view', 'View configured electronic payment providers'),
  ('provider.manage', 'Manage electronic payment provider configuration'),
  ('provider.settlement.view', 'View provider settlements and unmatched electronic evidence'),
  ('provider.settlement.record', 'Record or import provider settlement evidence'),
  ('provider.settlement.allocate', 'Match provider settlements to A5 payment evidence'),
  ('provider.settlement.reconcile', 'Finalize provider settlement reconciliation'),
  ('provider.settlement.reverse', 'Reverse a provider settlement allocation')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT role_code, permission_code
FROM (VALUES
  ('OWNER', 'provider.view'), ('OWNER', 'provider.manage'),
  ('OWNER', 'provider.settlement.view'), ('OWNER', 'provider.settlement.record'),
  ('OWNER', 'provider.settlement.allocate'), ('OWNER', 'provider.settlement.reconcile'),
  ('OWNER', 'provider.settlement.reverse'),
  ('ADMINISTRATOR', 'provider.view'), ('ADMINISTRATOR', 'provider.manage'),
  ('ADMINISTRATOR', 'provider.settlement.view'), ('ADMINISTRATOR', 'provider.settlement.record'),
  ('ADMINISTRATOR', 'provider.settlement.allocate'), ('ADMINISTRATOR', 'provider.settlement.reconcile'),
  ('ADMINISTRATOR', 'provider.settlement.reverse'),
  ('FINANCE', 'provider.view'), ('FINANCE', 'provider.settlement.view'),
  ('FINANCE', 'provider.settlement.record'), ('FINANCE', 'provider.settlement.allocate'),
  ('FINANCE', 'provider.settlement.reconcile'), ('FINANCE', 'provider.settlement.reverse'),
  ('SUPERVISOR', 'provider.view'), ('SUPERVISOR', 'provider.settlement.view'),
  ('SUPERVISOR', 'provider.settlement.record')
) AS seed(role_code, permission_code)
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a9_provider_account_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE station_entity uuid;
BEGIN
  IF NEW.station_id IS NOT NULL THEN
    SELECT s.legal_entity_id INTO station_entity
      FROM app.stations s
     WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.station_id;
    IF station_entity IS NULL THEN
      RAISE EXCEPTION 'provider account station is not in the provider account tenant';
    END IF;
    IF NEW.legal_entity_id IS NULL THEN
      NEW.legal_entity_id := station_entity;
    ELSIF NEW.legal_entity_id IS DISTINCT FROM station_entity THEN
      RAISE EXCEPTION 'provider account station and legal entity do not match';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_accounts_scope_guard
BEFORE INSERT OR UPDATE ON app.provider_accounts
FOR EACH ROW EXECUTE FUNCTION app.a9_provider_account_scope_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a9_provider_settlement_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE account_station uuid;
DECLARE account_currency text;
BEGIN
  SELECT a.station_id, a.currency INTO account_station, account_currency
    FROM app.provider_accounts a
   WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.provider_account_id;
  IF account_station IS NOT NULL AND account_station IS DISTINCT FROM NEW.station_id THEN
    RAISE EXCEPTION 'provider settlement station does not match provider account station';
  END IF;
  IF account_currency IS NULL OR account_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'provider settlement currency does not match provider account currency';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_settlements_scope_guard
BEFORE INSERT OR UPDATE ON app.provider_settlements
FOR EACH ROW EXECUTE FUNCTION app.a9_provider_settlement_scope_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a9_provider_settlement_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider settlement evidence is append-only; use a named reversal or adjustment';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.provider_account_id IS DISTINCT FROM NEW.provider_account_id
     OR OLD.station_id IS DISTINCT FROM NEW.station_id
     OR OLD.settlement_reference IS DISTINCT FROM NEW.settlement_reference
     OR OLD.batch_reference IS DISTINCT FROM NEW.batch_reference
     OR OLD.transaction_date IS DISTINCT FROM NEW.transaction_date
     OR OLD.settlement_date IS DISTINCT FROM NEW.settlement_date
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.gross_amount IS DISTINCT FROM NEW.gross_amount
     OR OLD.provider_fee_amount IS DISTINCT FROM NEW.provider_fee_amount
     OR OLD.provider_deduction_amount IS DISTINCT FROM NEW.provider_deduction_amount
     OR OLD.reported_net_amount IS DISTINCT FROM NEW.reported_net_amount
     OR OLD.source_type IS DISTINCT FROM NEW.source_type
     OR OLD.source_key IS DISTINCT FROM NEW.source_key
     OR OLD.source_metadata IS DISTINCT FROM NEW.source_metadata
     OR OLD.recorded_by IS DISTINCT FROM NEW.recorded_by THEN
    RAISE EXCEPTION 'provider settlement evidence is immutable; use a named reversal or adjustment';
  END IF;
  IF OLD.state = 'RECORDED' AND NEW.state NOT IN ('RECORDED','PARTIALLY_MATCHED','EXCEPTION','RECONCILED') THEN
    RAISE EXCEPTION 'invalid provider settlement transition from RECORDED';
  ELSIF OLD.state = 'PARTIALLY_MATCHED' AND NEW.state NOT IN ('PARTIALLY_MATCHED','EXCEPTION','RECONCILED') THEN
    RAISE EXCEPTION 'invalid provider settlement transition from PARTIALLY_MATCHED';
  ELSIF OLD.state = 'EXCEPTION' AND NEW.state NOT IN ('EXCEPTION','PARTIALLY_MATCHED','RECONCILED') THEN
    RAISE EXCEPTION 'invalid provider settlement transition from EXCEPTION';
  ELSIF OLD.state = 'RECONCILED' AND NEW.state <> 'EXCEPTION' THEN
    RAISE EXCEPTION 'reconciled provider settlement can only be reopened by a named reversal';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_settlements_immutable_guard
BEFORE UPDATE OR DELETE ON app.provider_settlements
FOR EACH ROW EXECUTE FUNCTION app.a9_provider_settlement_immutable_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a9_provider_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE payment_amount numeric(20,4);
DECLARE payment_method text;
DECLARE reconciliation_state text;
DECLARE payment_station uuid;
DECLARE settlement_station uuid;
DECLARE settlement_state text;
DECLARE settlement_gross numeric(20,4);
DECLARE allocated_to_payment numeric(20,4);
DECLARE allocated_to_settlement numeric(20,4);
DECLARE prior_reversal uuid;
DECLARE original_settlement uuid;
DECLARE original_payment uuid;
DECLARE original_station uuid;
DECLARE original_state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'provider settlement allocations are append-only; use a named reversal';
  END IF;
  SELECT p.amount, p.method, p.station_id, r.state
    INTO payment_amount, payment_method, payment_station, reconciliation_state
    FROM app.reconciliation_payments p
    JOIN app.reconciliations r
      ON r.tenant_id = p.tenant_id AND r.station_id = p.station_id AND r.id = p.reconciliation_id
   WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.reconciliation_payment_id
   FOR UPDATE OF p, r;
  IF payment_amount IS NULL THEN RAISE EXCEPTION 'A5 payment evidence does not exist'; END IF;
  IF payment_station IS DISTINCT FROM NEW.station_id THEN RAISE EXCEPTION 'A5 payment evidence station mismatch'; END IF;
  IF NEW.state = 'POSTED' THEN
    IF payment_method NOT IN ('POS','ECOCASH') THEN RAISE EXCEPTION 'cash or non-provider A5 evidence cannot be allocated to a provider settlement'; END IF;
    IF reconciliation_state NOT IN ('APPROVED','POSTED','LOCKED') THEN RAISE EXCEPTION 'A5 payment evidence is not eligible for provider settlement matching'; END IF;
    SELECT s.station_id, s.state, s.gross_amount
      INTO settlement_station, settlement_state, settlement_gross
      FROM app.provider_settlements s
     WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.settlement_id
     FOR UPDATE;
    IF settlement_station IS NULL THEN RAISE EXCEPTION 'Provider settlement does not exist'; END IF;
    IF settlement_station IS DISTINCT FROM NEW.station_id THEN RAISE EXCEPTION 'Provider settlement station mismatch'; END IF;
    IF settlement_state IN ('RECONCILED') THEN RAISE EXCEPTION 'A reconciled provider settlement is finalized'; END IF;
    SELECT COALESCE(sum(active.amount), 0) INTO allocated_to_payment
      FROM app.provider_settlement_allocations active
     WHERE active.tenant_id = NEW.tenant_id
       AND active.reconciliation_payment_id = NEW.reconciliation_payment_id
       AND active.state = 'POSTED'
       AND NOT EXISTS (
         SELECT 1 FROM app.provider_settlement_allocations reversal
          WHERE reversal.tenant_id = active.tenant_id
            AND reversal.reversal_of_id = active.id
            AND reversal.state = 'REVERSED'
       );
    SELECT COALESCE(sum(active.amount), 0) INTO allocated_to_settlement
      FROM app.provider_settlement_allocations active
     WHERE active.tenant_id = NEW.tenant_id
       AND active.settlement_id = NEW.settlement_id
       AND active.state = 'POSTED'
       AND NOT EXISTS (
         SELECT 1 FROM app.provider_settlement_allocations reversal
          WHERE reversal.tenant_id = active.tenant_id
            AND reversal.reversal_of_id = active.id
            AND reversal.state = 'REVERSED'
       );
    IF allocated_to_payment > payment_amount THEN RAISE EXCEPTION 'provider allocations exceed A5 payment evidence'; END IF;
    IF allocated_to_settlement > settlement_gross THEN RAISE EXCEPTION 'provider allocations exceed settlement gross amount'; END IF;
  ELSE
    SELECT amount, state, reversal_of_id, settlement_id, reconciliation_payment_id, station_id
      INTO payment_amount, original_state, prior_reversal, original_settlement, original_payment, original_station
      FROM app.provider_settlement_allocations
     WHERE tenant_id = NEW.tenant_id AND id = NEW.reversal_of_id
     FOR UPDATE;
    IF payment_amount IS NULL OR original_state <> 'POSTED' THEN RAISE EXCEPTION 'Only a posted allocation can be reversed'; END IF;
    IF original_settlement IS DISTINCT FROM NEW.settlement_id
       OR original_payment IS DISTINCT FROM NEW.reconciliation_payment_id
       OR original_station IS DISTINCT FROM NEW.station_id THEN
      RAISE EXCEPTION 'Allocation reversal must retain the original settlement, payment, and station';
    END IF;
    IF NEW.amount IS DISTINCT FROM payment_amount THEN RAISE EXCEPTION 'Allocation reversal amount must equal the original'; END IF;
    IF prior_reversal IS NOT NULL THEN RAISE EXCEPTION 'An allocation reversal cannot itself be reversed'; END IF;
    IF EXISTS (SELECT 1 FROM app.provider_settlement_allocations WHERE tenant_id = NEW.tenant_id AND reversal_of_id = NEW.reversal_of_id AND state = 'REVERSED') THEN
      RAISE EXCEPTION 'The provider settlement allocation is already reversed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER provider_settlement_allocations_total_guard
AFTER INSERT ON app.provider_settlement_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.a9_provider_allocation_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.a9_provider_allocation_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider settlement allocations are append-only; use a named reversal';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_settlement_allocations_append_only
BEFORE UPDATE OR DELETE ON app.provider_settlement_allocations
FOR EACH ROW EXECUTE FUNCTION app.a9_provider_allocation_append_only();
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['payment_providers','provider_accounts','provider_settlements','provider_settlement_allocations'] LOOP
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
    GRANT SELECT, INSERT, UPDATE ON app.payment_providers, app.provider_accounts, app.provider_settlements TO app_runtime;
    GRANT SELECT, INSERT ON app.provider_settlement_allocations TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    GRANT SELECT ON app.payment_providers, app.provider_accounts, app.provider_settlements, app.provider_settlement_allocations TO job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.payment_providers, app.provider_accounts, app.provider_settlements, app.provider_settlement_allocations TO diagnostics_readonly;
  END IF;
END
$$;
--> statement-breakpoint

REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.provider_settlement_allocations FROM app_runtime;
