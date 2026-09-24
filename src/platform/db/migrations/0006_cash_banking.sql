CREATE TABLE "app"."bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_reference_masked" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_accounts_tenant_legal_entity_name_uidx" UNIQUE("tenant_id","legal_entity_id","name"),
	CONSTRAINT "bank_accounts_currency_ck" CHECK ("app"."bank_accounts"."currency" = 'USD'),
	CONSTRAINT "bank_accounts_status_ck" CHECK ("app"."bank_accounts"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "app"."bank_deposit_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"deposit_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"allocated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_deposit_allocations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_deposit_allocations_deposit_collection_uidx" UNIQUE("tenant_id","station_id","deposit_id","collection_id"),
	CONSTRAINT "bank_deposit_allocations_amount_ck" CHECK ("app"."bank_deposit_allocations"."amount" > 0),
	CONSTRAINT "bank_deposit_allocations_currency_ck" CHECK ("app"."bank_deposit_allocations"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "app"."bank_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"deposit_reference" text NOT NULL,
	"state" text DEFAULT 'RECORDED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"deposited_at" timestamp with time zone NOT NULL,
	"expected_confirmation_at" timestamp with time zone,
	"confirmed_amount" numeric(20, 4),
	"confirmation_variance" numeric(20, 4),
	"bank_reference" text,
	"confirmed_at" timestamp with time zone,
	"recorded_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_deposits_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_deposits_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "bank_deposits_tenant_station_reference_uidx" UNIQUE("tenant_id","station_id","deposit_reference"),
	CONSTRAINT "bank_deposits_amount_ck" CHECK ("app"."bank_deposits"."amount" > 0 and ("app"."bank_deposits"."confirmed_amount" is null or "app"."bank_deposits"."confirmed_amount" >= 0)),
	CONSTRAINT "bank_deposits_variance_ck" CHECK ("app"."bank_deposits"."confirmation_variance" is null or "app"."bank_deposits"."confirmation_variance" = "app"."bank_deposits"."confirmed_amount" - "app"."bank_deposits"."amount"),
	CONSTRAINT "bank_deposits_currency_ck" CHECK ("app"."bank_deposits"."currency" = 'USD'),
	CONSTRAINT "bank_deposits_state_ck" CHECK ("app"."bank_deposits"."state" in ('RECORDED','SUBMITTED','CONFIRMED','REJECTED','REVERSED'))
);
--> statement-breakpoint
CREATE TABLE "app"."cash_collection_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"allocated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_collection_allocations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_collection_allocations_collection_reconciliation_uidx" UNIQUE("tenant_id","station_id","collection_id","reconciliation_id"),
	CONSTRAINT "cash_collection_allocations_amount_ck" CHECK ("app"."cash_collection_allocations"."amount" > 0),
	CONSTRAINT "cash_collection_allocations_currency_ck" CHECK ("app"."cash_collection_allocations"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "app"."cash_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"collection_reference" text NOT NULL,
	"source_location_id" uuid NOT NULL,
	"current_location_id" uuid NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"business_date" text NOT NULL,
	"state" text DEFAULT 'RECORDED' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"received_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_collections_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_collections_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "cash_collections_tenant_station_reference_uidx" UNIQUE("tenant_id","station_id","collection_reference"),
	CONSTRAINT "cash_collections_amount_ck" CHECK ("app"."cash_collections"."amount" > 0),
	CONSTRAINT "cash_collections_currency_ck" CHECK ("app"."cash_collections"."currency" = 'USD'),
	CONSTRAINT "cash_collections_state_ck" CHECK ("app"."cash_collections"."state" in ('RECORDED','RECEIVED','REVERSED'))
);
--> statement-breakpoint
CREATE TABLE "app"."cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"business_date" text NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"expected_amount" numeric(20, 4) NOT NULL,
	"counted_amount" numeric(20, 4) NOT NULL,
	"variance" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"explanation" text,
	"counted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_counts_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_counts_amounts_ck" CHECK ("app"."cash_counts"."expected_amount" >= 0 and "app"."cash_counts"."counted_amount" >= 0),
	CONSTRAINT "cash_counts_variance_ck" CHECK ("app"."cash_counts"."variance" = "app"."cash_counts"."counted_amount" - "app"."cash_counts"."expected_amount"),
	CONSTRAINT "cash_counts_currency_ck" CHECK ("app"."cash_counts"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "app"."cash_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"expected_amount" numeric(20, 4) NOT NULL,
	"counted_amount" numeric(20, 4),
	"variance" numeric(20, 4),
	"currency" text DEFAULT 'USD' NOT NULL,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"delivered_by" uuid NOT NULL,
	"received_by" uuid,
	"dispute_reason" text,
	"submitted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_handovers_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_handovers_locations_differ_ck" CHECK ("app"."cash_handovers"."from_location_id" <> "app"."cash_handovers"."to_location_id"),
	CONSTRAINT "cash_handovers_amounts_ck" CHECK ("app"."cash_handovers"."expected_amount" > 0 and ("app"."cash_handovers"."counted_amount" is null or "app"."cash_handovers"."counted_amount" >= 0)),
	CONSTRAINT "cash_handovers_variance_ck" CHECK ("app"."cash_handovers"."variance" is null or "app"."cash_handovers"."variance" = "app"."cash_handovers"."counted_amount" - "app"."cash_handovers"."expected_amount"),
	CONSTRAINT "cash_handovers_currency_ck" CHECK ("app"."cash_handovers"."currency" = 'USD'),
	CONSTRAINT "cash_handovers_state_ck" CHECK ("app"."cash_handovers"."state" in ('DRAFT','SUBMITTED','ACCEPTED','DISPUTED','RESOLVED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "app"."cash_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location_type" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_locations_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_locations_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "cash_locations_tenant_station_code_uidx" UNIQUE("tenant_id","station_id","code"),
	CONSTRAINT "cash_locations_type_ck" CHECK ("app"."cash_locations"."location_type" in ('STATION_TILL','STATION_SAFE','TRANSIT','COLLECTOR')),
	CONSTRAINT "cash_locations_currency_ck" CHECK ("app"."cash_locations"."currency" = 'USD'),
	CONSTRAINT "cash_locations_status_ck" CHECK ("app"."cash_locations"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "app"."cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"business_date" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"reason" text,
	"reversal_of_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_movements_source_uidx" UNIQUE("tenant_id","source_type","source_id","movement_type"),
	CONSTRAINT "cash_movements_type_ck" CHECK ("app"."cash_movements"."movement_type" in ('RECEIPT','DISBURSEMENT','TRANSFER','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
	CONSTRAINT "cash_movements_amount_ck" CHECK ("app"."cash_movements"."amount" > 0),
	CONSTRAINT "cash_movements_currency_ck" CHECK ("app"."cash_movements"."currency" = 'USD'),
	CONSTRAINT "cash_movements_direction_ck" CHECK ((
        ("app"."cash_movements"."movement_type" = 'RECEIPT' and "app"."cash_movements"."from_location_id" is null and "app"."cash_movements"."to_location_id" is not null)
        or ("app"."cash_movements"."movement_type" = 'DISBURSEMENT' and "app"."cash_movements"."from_location_id" is not null and "app"."cash_movements"."to_location_id" is null)
        or ("app"."cash_movements"."movement_type" = 'TRANSFER' and "app"."cash_movements"."from_location_id" is not null and "app"."cash_movements"."to_location_id" is not null and "app"."cash_movements"."from_location_id" <> "app"."cash_movements"."to_location_id")
        or ("app"."cash_movements"."movement_type" = 'ADJUSTMENT_IN' and "app"."cash_movements"."from_location_id" is null and "app"."cash_movements"."to_location_id" is not null)
        or ("app"."cash_movements"."movement_type" = 'ADJUSTMENT_OUT' and "app"."cash_movements"."from_location_id" is not null and "app"."cash_movements"."to_location_id" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "app"."bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposit_allocations" ADD CONSTRAINT "bank_deposit_allocations_deposit_fk" FOREIGN KEY ("tenant_id","station_id","deposit_id") REFERENCES "app"."bank_deposits"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposit_allocations" ADD CONSTRAINT "bank_deposit_allocations_collection_fk" FOREIGN KEY ("tenant_id","station_id","collection_id") REFERENCES "app"."cash_collections"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposit_allocations" ADD CONSTRAINT "bank_deposit_allocations_allocated_by_fk" FOREIGN KEY ("tenant_id","allocated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposits" ADD CONSTRAINT "bank_deposits_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposits" ADD CONSTRAINT "bank_deposits_source_location_fk" FOREIGN KEY ("tenant_id","station_id","source_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposits" ADD CONSTRAINT "bank_deposits_bank_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "app"."bank_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposits" ADD CONSTRAINT "bank_deposits_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bank_deposits" ADD CONSTRAINT "bank_deposits_confirmed_by_fk" FOREIGN KEY ("tenant_id","confirmed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collection_allocations" ADD CONSTRAINT "cash_collection_allocations_collection_fk" FOREIGN KEY ("tenant_id","station_id","collection_id") REFERENCES "app"."cash_collections"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collection_allocations" ADD CONSTRAINT "cash_collection_allocations_reconciliation_fk" FOREIGN KEY ("tenant_id","station_id","reconciliation_id") REFERENCES "app"."reconciliations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collection_allocations" ADD CONSTRAINT "cash_collection_allocations_allocated_by_fk" FOREIGN KEY ("tenant_id","allocated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collections" ADD CONSTRAINT "cash_collections_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collections" ADD CONSTRAINT "cash_collections_source_location_fk" FOREIGN KEY ("tenant_id","station_id","source_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collections" ADD CONSTRAINT "cash_collections_current_location_fk" FOREIGN KEY ("tenant_id","station_id","current_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collections" ADD CONSTRAINT "cash_collections_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_collections" ADD CONSTRAINT "cash_collections_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_counts" ADD CONSTRAINT "cash_counts_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_counts" ADD CONSTRAINT "cash_counts_location_fk" FOREIGN KEY ("tenant_id","station_id","location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_counts" ADD CONSTRAINT "cash_counts_counted_by_fk" FOREIGN KEY ("tenant_id","counted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_handovers" ADD CONSTRAINT "cash_handovers_from_location_fk" FOREIGN KEY ("tenant_id","station_id","from_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_handovers" ADD CONSTRAINT "cash_handovers_to_location_fk" FOREIGN KEY ("tenant_id","station_id","to_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_handovers" ADD CONSTRAINT "cash_handovers_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_handovers" ADD CONSTRAINT "cash_handovers_delivered_by_fk" FOREIGN KEY ("tenant_id","delivered_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_handovers" ADD CONSTRAINT "cash_handovers_received_by_fk" FOREIGN KEY ("tenant_id","received_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_locations" ADD CONSTRAINT "cash_locations_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_movements" ADD CONSTRAINT "cash_movements_tenant_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_movements" ADD CONSTRAINT "cash_movements_from_location_fk" FOREIGN KEY ("tenant_id","station_id","from_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_movements" ADD CONSTRAINT "cash_movements_to_location_fk" FOREIGN KEY ("tenant_id","station_id","to_location_id") REFERENCES "app"."cash_locations"("tenant_id","station_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cash_movements" ADD CONSTRAINT "cash_movements_actor_membership_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_deposit_allocations_collection_idx" ON "app"."bank_deposit_allocations" USING btree ("tenant_id","station_id","collection_id");--> statement-breakpoint
CREATE INDEX "bank_deposits_tenant_state_idx" ON "app"."bank_deposits" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "cash_collection_allocations_reconciliation_idx" ON "app"."cash_collection_allocations" USING btree ("tenant_id","station_id","reconciliation_id");--> statement-breakpoint
CREATE INDEX "cash_collections_tenant_station_state_idx" ON "app"."cash_collections" USING btree ("tenant_id","station_id","state");--> statement-breakpoint
CREATE INDEX "cash_counts_tenant_station_date_idx" ON "app"."cash_counts" USING btree ("tenant_id","station_id","business_date");--> statement-breakpoint
CREATE INDEX "cash_handovers_tenant_station_state_idx" ON "app"."cash_handovers" USING btree ("tenant_id","station_id","state");--> statement-breakpoint
CREATE INDEX "cash_locations_tenant_station_status_idx" ON "app"."cash_locations" USING btree ("tenant_id","station_id","status");--> statement-breakpoint
CREATE INDEX "cash_movements_tenant_station_effective_idx" ON "app"."cash_movements" USING btree ("tenant_id","station_id","effective_at");--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('cash.collection.view', 'View station cash collections and custody balances'),
  ('cash.collection.record', 'Record a station cash collection'),
  ('cash.collection.receive', 'Acknowledge receipt of collected cash'),
  ('cash.deposit.view', 'View bank deposits and allocations'),
  ('cash.location.manage', 'Manage station cash locations'),
  ('cash.count.record', 'Record a physical cash count'),
  ('cash.handover.submit', 'Submit a cash handover'),
  ('cash.handover.accept', 'Accept a cash handover'),
  ('cash.handover.resolve', 'Resolve a disputed cash handover'),
  ('cash.deposit.record', 'Record a bank deposit'),
  ('cash.deposit.confirm', 'Confirm a bank deposit')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION app.enforce_cash_collection_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_collection_id uuid;
  target_tenant_id uuid;
  target_station_id uuid;
  collection_amount numeric;
  allocated_amount numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_collection_id := OLD.collection_id;
    target_tenant_id := OLD.tenant_id;
    target_station_id := OLD.station_id;
  ELSE
    target_collection_id := NEW.collection_id;
    target_tenant_id := NEW.tenant_id;
    target_station_id := NEW.station_id;
  END IF;
  SELECT amount INTO collection_amount
  FROM app.cash_collections
  WHERE tenant_id = target_tenant_id
    AND station_id = target_station_id
    AND id = target_collection_id;
  SELECT COALESCE(sum(amount), 0) INTO allocated_amount
  FROM app.cash_collection_allocations
  WHERE tenant_id = target_tenant_id
    AND station_id = target_station_id
    AND collection_id = target_collection_id;
  IF collection_amount IS NULL OR allocated_amount <> collection_amount THEN
    RAISE EXCEPTION 'cash collection allocations must equal the authoritative collection amount';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cash_collection_allocations_total_guard
AFTER INSERT OR UPDATE OR DELETE ON app.cash_collection_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.enforce_cash_collection_allocation_total();

CREATE OR REPLACE FUNCTION app.enforce_bank_deposit_allocation_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_deposit_id uuid;
  target_collection_id uuid;
  target_tenant_id uuid;
  target_station_id uuid;
  deposit_state text;
  deposit_amount numeric;
  allocated_to_deposit numeric;
  collection_amount numeric;
  allocated_from_collection numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_deposit_id := OLD.deposit_id;
    target_collection_id := OLD.collection_id;
    target_tenant_id := OLD.tenant_id;
    target_station_id := OLD.station_id;
  ELSE
    target_deposit_id := NEW.deposit_id;
    target_collection_id := NEW.collection_id;
    target_tenant_id := NEW.tenant_id;
    target_station_id := NEW.station_id;
  END IF;

  SELECT state, amount INTO deposit_state, deposit_amount
  FROM app.bank_deposits
  WHERE tenant_id = target_tenant_id
    AND station_id = target_station_id
    AND id = target_deposit_id;
  SELECT COALESCE(sum(amount), 0) INTO allocated_to_deposit
  FROM app.bank_deposit_allocations
  WHERE tenant_id = target_tenant_id
    AND station_id = target_station_id
    AND deposit_id = target_deposit_id;
  IF deposit_state IS NULL OR (deposit_state <> 'REVERSED' AND allocated_to_deposit <> deposit_amount) THEN
    RAISE EXCEPTION 'bank deposit amount must equal its active collection allocations';
  END IF;

  SELECT amount INTO collection_amount
  FROM app.cash_collections
  WHERE tenant_id = target_tenant_id
    AND station_id = target_station_id
    AND id = target_collection_id;
  SELECT COALESCE(sum(a.amount), 0) INTO allocated_from_collection
  FROM app.bank_deposit_allocations a
  JOIN app.bank_deposits d
    ON d.tenant_id = a.tenant_id AND d.station_id = a.station_id AND d.id = a.deposit_id
  WHERE a.tenant_id = target_tenant_id
    AND a.station_id = target_station_id
    AND a.collection_id = target_collection_id
    AND d.state <> 'REVERSED';
  IF collection_amount IS NULL OR allocated_from_collection > collection_amount THEN
    RAISE EXCEPTION 'bank deposit allocations exceed the authoritative collection amount';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER bank_deposit_allocations_total_guard
AFTER INSERT OR UPDATE OR DELETE ON app.bank_deposit_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.enforce_bank_deposit_allocation_totals();

-- Every A6 row is fail-closed behind the existing tenant context and active membership.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cash_locations', 'cash_movements', 'cash_counts', 'cash_handovers',
    'cash_collections', 'cash_collection_allocations',
    'bank_accounts', 'bank_deposits', 'bank_deposit_allocations'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())',
      table_name || '_tenant_context', table_name
    );
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'cash_locations', 'cash_movements', 'cash_counts', 'cash_handovers',
      'cash_collections', 'cash_collection_allocations',
      'bank_accounts', 'bank_deposits', 'bank_deposit_allocations'
    ] LOOP
      EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name);
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.cash_locations, app.cash_handovers, app.cash_collections, app.bank_deposits TO app_runtime;
    GRANT SELECT, INSERT ON app.cash_movements, app.cash_counts, app.cash_collection_allocations, app.bank_accounts, app.bank_deposit_allocations TO app_runtime;
    REVOKE UPDATE ON app.cash_collections, app.bank_deposits FROM app_runtime;
    GRANT UPDATE (current_location_id, state, received_by, received_at, version, updated_at) ON app.cash_collections TO app_runtime;
    GRANT UPDATE (state, confirmed_amount, confirmation_variance, bank_reference, confirmed_by, confirmed_at, version, updated_at) ON app.bank_deposits TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.cash_locations, app.cash_movements, app.cash_counts, app.cash_handovers, app.cash_collections, app.cash_collection_allocations, app.bank_accounts, app.bank_deposits, app.bank_deposit_allocations TO diagnostics_readonly;
  END IF;
END
$$;

-- Authoritative movement and allocation facts are append-only for the runtime role.
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON
  app.cash_movements, app.cash_counts, app.cash_collection_allocations, app.bank_deposit_allocations
FROM app_runtime;
