CREATE TABLE "app"."expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "station_id" uuid,
  "business_date" text NOT NULL,
  "description" text NOT NULL,
  "category" text,
  "amount" numeric(20,4) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "classification" text NOT NULL,
  "settlement_source" text NOT NULL,
  "state" text DEFAULT 'DRAFT' NOT NULL,
  "approval_required" boolean DEFAULT true NOT NULL,
  "required_approver_count" integer DEFAULT 1 NOT NULL,
  "requires_step_up" boolean DEFAULT false NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_by" uuid NOT NULL,
  "submitted_by" uuid,
  "returned_by" uuid,
  "rejected_by" uuid,
  "approved_by" uuid,
  "posted_by" uuid,
  "reversed_by" uuid,
  "submitted_at" timestamp with time zone,
  "returned_at" timestamp with time zone,
  "return_reason" text,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "approved_at" timestamp with time zone,
  "posted_at" timestamp with time zone,
  "reversed_at" timestamp with time zone,
  "reversal_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expenses_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
  CONSTRAINT "expenses_description_nonempty_ck" CHECK (btrim("description") <> ''),
  CONSTRAINT "expenses_category_nonempty_ck" CHECK ("category" is null or btrim("category") <> ''),
  CONSTRAINT "expenses_amount_nonnegative_ck" CHECK ("amount" >= 0),
  CONSTRAINT "expenses_currency_ck" CHECK ("currency" = 'USD'),
  CONSTRAINT "expenses_classification_ck" CHECK ("classification" in ('OPERATING_EXPENSE','DIRECT_INVENTORY_COST','RECURRING_FIXED_COST')),
  CONSTRAINT "expenses_settlement_source_ck" CHECK ("settlement_source" in ('CASH','BANK','PAYABLE','REIMBURSEMENT')),
  CONSTRAINT "expenses_state_ck" CHECK ("state" in ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','POSTED','REVERSED')),
  CONSTRAINT "expenses_required_approvers_ck" CHECK ("required_approver_count" between 0 and 2),
  CONSTRAINT "expenses_approval_policy_ck" CHECK ("approval_required" = ("required_approver_count" > 0)),
  CONSTRAINT "expenses_post_provenance_ck" CHECK ("posted_at" is null or "posted_by" is not null),
  CONSTRAINT "expenses_reversal_provenance_ck" CHECK ("state" <> 'REVERSED' or ("reversed_by" is not null and "reversed_at" is not null and btrim(coalesce("reversal_reason", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "app"."expense_recognition_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "station_id" uuid,
  "expense_id" uuid NOT NULL,
  "recognition_type" text NOT NULL,
  "recognition_date" text NOT NULL,
  "classification" text NOT NULL,
  "recognition_kind" text NOT NULL,
  "amount" numeric(20,4) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expense_recognition_events_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
  CONSTRAINT "expense_recognition_events_expense_type_uidx" UNIQUE("tenant_id","expense_id","recognition_type"),
  CONSTRAINT "expense_recognition_events_type_ck" CHECK ("recognition_type" in ('RECOGNITION','REVERSAL')),
  CONSTRAINT "expense_recognition_events_classification_ck" CHECK ("classification" in ('OPERATING_EXPENSE','DIRECT_INVENTORY_COST','RECURRING_FIXED_COST')),
  CONSTRAINT "expense_recognition_events_currency_ck" CHECK ("currency" = 'USD')
);
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_returned_by_fk" FOREIGN KEY ("tenant_id","returned_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_rejected_by_fk" FOREIGN KEY ("tenant_id","rejected_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_events" ADD CONSTRAINT "expense_recognition_events_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_events" ADD CONSTRAINT "expense_recognition_events_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_events" ADD CONSTRAINT "expense_recognition_events_expense_fk" FOREIGN KEY ("tenant_id","expense_id") REFERENCES "app"."expenses"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_events" ADD CONSTRAINT "expense_recognition_events_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
CREATE INDEX "expenses_tenant_entity_station_date_idx" ON "app"."expenses" USING btree ("tenant_id","legal_entity_id","station_id","business_date");--> statement-breakpoint
CREATE INDEX "expenses_tenant_state_idx" ON "app"."expenses" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "expense_recognition_events_reporting_idx" ON "app"."expense_recognition_events" USING btree ("tenant_id","station_id","recognition_date","effective_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a13_expense_state_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state NOT IN ('DRAFT','SUBMITTED','RETURNED') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
    NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.business_date IS DISTINCT FROM OLD.business_date OR
    NEW.description IS DISTINCT FROM OLD.description OR NEW.category IS DISTINCT FROM OLD.category OR
    NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.classification IS DISTINCT FROM OLD.classification OR NEW.settlement_source IS DISTINCT FROM OLD.settlement_source
  ) THEN RAISE EXCEPTION 'finalized expense facts are immutable'; END IF;
  IF OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT','SUBMITTED') THEN RAISE EXCEPTION 'draft expenses must be submitted before approval or rejection'; END IF;
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED','RETURNED','APPROVED','REJECTED') THEN RAISE EXCEPTION 'submitted expenses have an invalid transition'; END IF;
  IF OLD.state = 'RETURNED' AND NEW.state NOT IN ('RETURNED','SUBMITTED') THEN RAISE EXCEPTION 'returned expenses must be resubmitted before approval'; END IF;
  IF OLD.state = 'APPROVED' AND NEW.state NOT IN ('APPROVED','POSTED') THEN RAISE EXCEPTION 'approved expenses may only be posted'; END IF;
  IF OLD.state = 'REJECTED' AND NEW.state <> 'REJECTED' THEN RAISE EXCEPTION 'rejected expenses are terminal'; END IF;
  IF OLD.state = 'POSTED' AND NEW.state NOT IN ('POSTED','REVERSED') THEN RAISE EXCEPTION 'posted expenses may only be reversed'; END IF;
  IF OLD.state = 'REVERSED' AND NEW.state <> 'REVERSED' THEN RAISE EXCEPTION 'reversed expenses are terminal'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER expenses_state_guard BEFORE UPDATE ON app.expenses FOR EACH ROW EXECUTE FUNCTION app.a13_expense_state_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.a13_expense_recognition_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'expense recognition events are append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER expense_recognition_events_immutable_guard BEFORE UPDATE OR DELETE ON app.expense_recognition_events FOR EACH ROW EXECUTE FUNCTION app.a13_expense_recognition_immutable_guard();
--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('expense.view', 'View station and management expenses'),
  ('expense.submit', 'Create and submit an expense'),
  ('expense.approve', 'Approve or reject a submitted expense'),
  ('expense.post', 'Post an approved expense and recognize its economic effect'),
  ('expense.reverse', 'Reverse a posted expense with a named reason')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT role_code, permission_code FROM (VALUES
  ('OWNER','expense.view'),('OWNER','expense.submit'),('OWNER','expense.approve'),('OWNER','expense.post'),('OWNER','expense.reverse'),
  ('SUPERVISOR','expense.view'),('SUPERVISOR','expense.submit')
) AS permissions(role_code, permission_code)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['expenses','expense_recognition_events'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name || '_tenant_context', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN EXECUTE format('ALTER TABLE app.%I OWNER TO migration_owner', table_name); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.expenses TO app_runtime;
    GRANT SELECT, INSERT ON app.expense_recognition_events TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN GRANT SELECT ON app.expenses, app.expense_recognition_events TO diagnostics_readonly; END IF;
END
$$;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.expense_recognition_events FROM app_runtime;
