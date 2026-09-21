CREATE TABLE "app"."forecourt_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"responsible_attendant_id" uuid,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecourt_audit_events_tenant_id_id_uidx" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."forecourt_idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"result_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecourt_idempotency_tenant_command_key_uidx" UNIQUE("tenant_id","command_type","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "app"."forecourt_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "forecourt_outbox_tenant_event_uidx" UNIQUE("tenant_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "posted_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."forecourt_audit_events" ADD CONSTRAINT "forecourt_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_audit_events" ADD CONSTRAINT "forecourt_audit_events_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_audit_events" ADD CONSTRAINT "forecourt_audit_events_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_audit_events" ADD CONSTRAINT "forecourt_audit_events_attendant_fk" FOREIGN KEY ("tenant_id","responsible_attendant_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_idempotency_records" ADD CONSTRAINT "forecourt_idempotency_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_outbox" ADD CONSTRAINT "forecourt_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecourt_outbox" ADD CONSTRAINT "forecourt_outbox_station_fk" FOREIGN KEY ("tenant_id","station_id") REFERENCES "app"."stations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecourt_audit_events_subject_idx" ON "app"."forecourt_audit_events" USING btree ("tenant_id","subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "forecourt_idempotency_tenant_created_idx" ON "app"."forecourt_idempotency_records" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "forecourt_outbox_unpublished_idx" ON "app"."forecourt_outbox" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_revisions" ADD CONSTRAINT "reconciliation_revisions_locked_by_fk" FOREIGN KEY ("tenant_id","locked_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;

-- Final A3 integrity guards: workflow transitions, durable provenance, and
-- database-backed idempotency/audit/outbox all execute inside the same tenant
-- transaction as the business mutation.
ALTER TABLE app.payment_declarations ADD CONSTRAINT payment_declarations_category_ck CHECK (category IN ('CASH', 'ELECTRONIC', 'CUSTOMER_ACCOUNT', 'PREPAID', 'BENEFIT_INTERNAL', 'OTHER'));
ALTER TABLE app.payment_declarations ADD CONSTRAINT payment_declarations_amount_ck CHECK (amount >= 0);
ALTER TABLE app.payment_declarations ADD CONSTRAINT payment_declarations_currency_ck CHECK (currency = 'USD');
ALTER TABLE app.reconciliation_revisions ADD CONSTRAINT reconciliation_revisions_variance_classification_ck CHECK (variance_classification IN ('INFORMATIONAL', 'REQUIRES_EXPLANATION', 'BLOCKING'));
ALTER TABLE app.reconciliation_revisions ADD CONSTRAINT reconciliation_revisions_currency_ck CHECK (currency = 'USD');
ALTER TABLE app.forecourt_idempotency_records ADD CONSTRAINT forecourt_idempotency_status_ck CHECK (status IN ('IN_PROGRESS', 'COMPLETED'));
ALTER TABLE app.forecourt_idempotency_records ADD CONSTRAINT forecourt_idempotency_key_ck CHECK (btrim(idempotency_key) <> '' AND btrim(request_hash) <> '');

CREATE OR REPLACE FUNCTION app.validate_reconciliation_revision_payload()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE declaration jsonb;
BEGIN
  IF jsonb_typeof(NEW.declarations) <> 'array' THEN
    RAISE EXCEPTION 'reconciliation declarations must be a JSON array';
  END IF;
  FOR declaration IN SELECT value FROM jsonb_array_elements(NEW.declarations) LOOP
    IF jsonb_typeof(declaration) <> 'object'
       OR declaration->>'category' NOT IN ('CASH', 'ELECTRONIC', 'CUSTOMER_ACCOUNT', 'PREPAID', 'BENEFIT_INTERNAL', 'OTHER')
       OR declaration->>'declaredBy' IS NULL
       OR btrim(declaration->>'declaredBy') = ''
       OR declaration->>'amount' IS NULL
       OR (declaration->>'amount') !~ '^[0-9]+([.][0-9]+)?$'
       OR (declaration->>'amount')::numeric < 0
       OR (declaration ? 'currency' AND declaration->>'currency' <> NEW.currency) THEN
      RAISE EXCEPTION 'reconciliation declaration has an invalid category, amount, currency, or provenance';
    END IF;
  END LOOP;
  IF jsonb_typeof(NEW.source_segment_ids) <> 'array' THEN
    RAISE EXCEPTION 'reconciliation source segment lineage must be a JSON array';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.source_segment_ids) AS source(value)
    WHERE jsonb_typeof(source.value) <> 'string'
      OR source.value #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'reconciliation source segment lineage contains a non-UUID value';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reconciliation_revisions_payload_guard
BEFORE INSERT OR UPDATE ON app.reconciliation_revisions
FOR EACH ROW EXECUTE FUNCTION app.validate_reconciliation_revision_payload();

CREATE OR REPLACE FUNCTION app.enforce_forecourt_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'station_business_days' THEN
    allowed := (OLD.state, NEW.state) IN (('NOT_STARTED', 'OPEN'), ('OPEN', 'OPERATIONS_COMPLETE'), ('OPERATIONS_COMPLETE', 'CLOSED'), ('CLOSED', 'LOCKED'), ('NOT_STARTED', 'EXCEPTIONALLY_CLOSED'), ('OPEN', 'EXCEPTIONALLY_CLOSED'), ('OPERATIONS_COMPLETE', 'EXCEPTIONALLY_CLOSED'));
  ELSIF TG_TABLE_NAME = 'shifts' THEN
    allowed := (OLD.state, NEW.state) IN (('PLANNED', 'OPEN'), ('OPEN', 'METER_CLOSED'), ('METER_CLOSED', 'COMPLETED'), ('PLANNED', 'NOT_OPERATED'), ('PLANNED', 'CANCELLED_BEFORE_START'), ('OPEN', 'EXCEPTIONALLY_CLOSED'), ('METER_CLOSED', 'EXCEPTIONALLY_CLOSED'));
  ELSIF TG_TABLE_NAME = 'reconciliation_revisions' OR TG_TABLE_NAME = 'reconciliations' THEN
    allowed := (OLD.state, NEW.state) IN (('DRAFT', 'READY'), ('READY', 'SUBMITTED'), ('SUBMITTED', 'PENDING_APPROVAL'), ('PENDING_APPROVAL', 'RETURNED'), ('PENDING_APPROVAL', 'REJECTED'), ('PENDING_APPROVAL', 'APPROVED'), ('RETURNED', 'SUBMITTED'), ('APPROVED', 'POSTED'), ('POSTED', 'LOCKED'));
  ELSIF TG_TABLE_NAME = 'selling_prices' THEN
    allowed := (OLD.state, NEW.state) IN (('DRAFT', 'PENDING_APPROVAL'), ('PENDING_APPROVAL', 'APPROVED'), ('PENDING_APPROVAL', 'CANCELLED'), ('APPROVED', 'SCHEDULED'), ('APPROVED', 'PENDING_STATION_ACTIVATION'), ('APPROVED', 'CANCELLED'), ('SCHEDULED', 'PENDING_STATION_ACTIVATION'), ('SCHEDULED', 'CANCELLED'), ('PENDING_STATION_ACTIVATION', 'BOUNDARIES_IN_PROGRESS'), ('PENDING_STATION_ACTIVATION', 'FAILED_ACTIVATION'), ('BOUNDARIES_IN_PROGRESS', 'ACTIVE'), ('BOUNDARIES_IN_PROGRESS', 'FAILED_ACTIVATION'), ('FAILED_ACTIVATION', 'PENDING_STATION_ACTIVATION'), ('FAILED_ACTIVATION', 'CANCELLED'));
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'forbidden direct forecourt workflow transition: % -> % on %', OLD.state, NEW.state, TG_TABLE_NAME; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER station_business_days_transition_guard BEFORE UPDATE OF state ON app.station_business_days FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER shifts_transition_guard BEFORE UPDATE OF state ON app.shifts FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER reconciliations_transition_guard BEFORE UPDATE OF state ON app.reconciliations FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER reconciliation_revisions_transition_guard BEFORE UPDATE OF state ON app.reconciliation_revisions FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();
CREATE TRIGGER selling_prices_transition_guard BEFORE UPDATE OF state ON app.selling_prices FOR EACH ROW EXECUTE FUNCTION app.enforce_forecourt_state_transition();

CREATE OR REPLACE FUNCTION app.reject_authoritative_forecourt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'meter_segments' OR OLD.state IN ('APPROVED', 'POSTED', 'LOCKED', 'CLOSED', 'EXCEPTIONALLY_CLOSED') THEN
      RAISE EXCEPTION 'authoritative forecourt history is append-only';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'meter_segments' THEN
    RAISE EXCEPTION 'sealed meter segments are immutable; use a correction or reversal';
  ELSIF TG_TABLE_NAME = 'reconciliation_revisions' THEN
    IF OLD.state = 'LOCKED' THEN RAISE EXCEPTION 'locked reconciliation revisions are immutable'; END IF;
    IF OLD.state = 'APPROVED' AND NEW.state = 'POSTED'
       AND NEW.reconciliation_id IS NOT DISTINCT FROM OLD.reconciliation_id
       AND NEW.station_id IS NOT DISTINCT FROM OLD.station_id
       AND NEW.revision IS NOT DISTINCT FROM OLD.revision
       AND NEW.expected_sales IS NOT DISTINCT FROM OLD.expected_sales
       AND NEW.accounted_sales IS NOT DISTINCT FROM OLD.accounted_sales
       AND NEW.variance IS NOT DISTINCT FROM OLD.variance
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.variance_classification IS NOT DISTINCT FROM OLD.variance_classification
       AND NEW.variance_explanation IS NOT DISTINCT FROM OLD.variance_explanation
       AND NEW.declarations IS NOT DISTINCT FROM OLD.declarations
       AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by
       AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
       AND NEW.source_segment_ids IS NOT DISTINCT FROM OLD.source_segment_ids
       AND NEW.source_revision_id IS NOT DISTINCT FROM OLD.source_revision_id
       AND NEW.correction_of_revision_id IS NOT DISTINCT FROM OLD.correction_of_revision_id
       AND NEW.posted_by IS NOT NULL AND NEW.posted_at IS NOT NULL THEN RETURN NEW;
    END IF;
    IF OLD.state = 'POSTED' AND NEW.state = 'LOCKED'
       AND NEW.reconciliation_id IS NOT DISTINCT FROM OLD.reconciliation_id
       AND NEW.station_id IS NOT DISTINCT FROM OLD.station_id
       AND NEW.revision IS NOT DISTINCT FROM OLD.revision
       AND NEW.expected_sales IS NOT DISTINCT FROM OLD.expected_sales
       AND NEW.accounted_sales IS NOT DISTINCT FROM OLD.accounted_sales
       AND NEW.variance IS NOT DISTINCT FROM OLD.variance
       AND NEW.currency IS NOT DISTINCT FROM OLD.currency
       AND NEW.variance_classification IS NOT DISTINCT FROM OLD.variance_classification
       AND NEW.variance_explanation IS NOT DISTINCT FROM OLD.variance_explanation
       AND NEW.declarations IS NOT DISTINCT FROM OLD.declarations
       AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by
       AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
       AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
       AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.source_segment_ids IS NOT DISTINCT FROM OLD.source_segment_ids
       AND NEW.source_revision_id IS NOT DISTINCT FROM OLD.source_revision_id
       AND NEW.correction_of_revision_id IS NOT DISTINCT FROM OLD.correction_of_revision_id
       AND NEW.locked_by IS NOT NULL AND NEW.locked_at IS NOT NULL THEN RETURN NEW;
    END IF;
    IF OLD.state IN ('SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED') THEN
      IF NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.expected_sales IS DISTINCT FROM OLD.expected_sales OR NEW.accounted_sales IS DISTINCT FROM OLD.accounted_sales OR NEW.variance IS DISTINCT FROM OLD.variance OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.variance_classification IS DISTINCT FROM OLD.variance_classification OR NEW.declarations IS DISTINCT FROM OLD.declarations OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.source_segment_ids IS DISTINCT FROM OLD.source_segment_ids OR NEW.source_revision_id IS DISTINCT FROM OLD.source_revision_id OR NEW.correction_of_revision_id IS DISTINCT FROM OLD.correction_of_revision_id THEN
        RAISE EXCEPTION 'submitted and posted reconciliation revision values are immutable';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'station_business_days' AND OLD.state IN ('CLOSED', 'EXCEPTIONALLY_CLOSED', 'LOCKED') THEN
    IF OLD.state <> 'CLOSED' OR NEW.state <> 'LOCKED' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.business_date IS DISTINCT FROM OLD.business_date THEN RAISE EXCEPTION 'closed and locked business days are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'selling_prices' AND OLD.state IN ('ACTIVE', 'FAILED_ACTIVATION') THEN
    RAISE EXCEPTION 'historical activated prices are immutable';
  ELSIF TG_TABLE_NAME = 'reconciliations' AND OLD.state IN ('LOCKED', 'APPROVED', 'POSTED') THEN
    IF OLD.state = 'LOCKED' OR NOT (NEW.state IN ('POSTED', 'LOCKED') AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.station_id IS NOT DISTINCT FROM OLD.station_id AND NEW.business_day_id IS NOT DISTINCT FROM OLD.business_day_id) THEN RAISE EXCEPTION 'approved, posted, and locked reconciliations are immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.reject_forecourt_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'forecourt audit history is append-only'; END;
$$;
CREATE TRIGGER forecourt_audit_append_only_guard BEFORE UPDATE OR DELETE ON app.forecourt_audit_events FOR EACH ROW EXECUTE FUNCTION app.reject_forecourt_audit_mutation();
CREATE OR REPLACE FUNCTION app.guard_forecourt_outbox_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.event_type IS DISTINCT FROM OLD.event_type OR NEW.event_version IS DISTINCT FROM OLD.event_version OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'forecourt outbox events are append-only; only published_at may change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER forecourt_outbox_append_only_guard BEFORE UPDATE OR DELETE ON app.forecourt_outbox FOR EACH ROW EXECUTE FUNCTION app.guard_forecourt_outbox_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['forecourt_idempotency_records', 'forecourt_audit_events', 'forecourt_outbox'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name); END IF;
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
  END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN GRANT SELECT, INSERT, UPDATE ON app.forecourt_idempotency_records, app.forecourt_outbox TO app_runtime; GRANT SELECT, INSERT ON app.forecourt_audit_events TO app_runtime; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN GRANT SELECT, UPDATE ON app.forecourt_outbox TO job_runtime; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN GRANT SELECT ON app.forecourt_idempotency_records, app.forecourt_audit_events, app.forecourt_outbox TO diagnostics_readonly; END IF;
END
$$;
