CREATE TABLE "app"."expense_recurring_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "legal_entity_id" uuid NOT NULL,
  "station_id" uuid,
  "description" text NOT NULL,
  "category" text,
  "amount" numeric(20,4) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "settlement_source" text NOT NULL,
  "interval_unit" text NOT NULL,
  "interval_count" integer NOT NULL,
  "anchor_date" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "approval_required" boolean DEFAULT true NOT NULL,
  "required_approver_count" integer DEFAULT 1 NOT NULL,
  "requires_step_up" boolean DEFAULT false NOT NULL,
  "step_up_threshold" numeric(20,4),
  "second_approver_threshold" numeric(20,4),
  "version" integer DEFAULT 0 NOT NULL,
  "created_by" uuid NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expense_recurring_templates_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
  CONSTRAINT "expense_recurring_templates_description_nonempty_ck" CHECK (btrim("description") <> ''),
  CONSTRAINT "expense_recurring_templates_category_nonempty_ck" CHECK ("category" is null or btrim("category") <> ''),
  CONSTRAINT "expense_recurring_templates_amount_positive_ck" CHECK ("amount" > 0),
  CONSTRAINT "expense_recurring_templates_currency_ck" CHECK ("currency" = 'USD'),
  CONSTRAINT "expense_recurring_templates_settlement_source_ck" CHECK ("settlement_source" in ('CASH','BANK','PAYABLE','REIMBURSEMENT')),
  CONSTRAINT "expense_recurring_templates_interval_unit_ck" CHECK ("interval_unit" in ('DAY','WEEK','MONTH','YEAR')),
  CONSTRAINT "expense_recurring_templates_interval_count_ck" CHECK ("interval_count" between 1 and 3650),
  CONSTRAINT "expense_recurring_templates_anchor_date_ck" CHECK ("anchor_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "expense_recurring_templates_required_approvers_ck" CHECK ("required_approver_count" between 0 and 2),
  CONSTRAINT "expense_recurring_templates_approval_policy_ck" CHECK ("approval_required" = ("required_approver_count" > 0)),
  CONSTRAINT "expense_recurring_templates_thresholds_ck" CHECK (("step_up_threshold" is null or "step_up_threshold" >= 0) and ("second_approver_threshold" is null or "second_approver_threshold" >= 0))
);
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD COLUMN "recurring_template_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."expense_recurring_templates" ADD CONSTRAINT "expense_recurring_templates_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id");--> statement-breakpoint
ALTER TABLE "app"."expense_recurring_templates" ADD CONSTRAINT "expense_recurring_templates_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recurring_templates" ADD CONSTRAINT "expense_recurring_templates_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recurring_templates" ADD CONSTRAINT "expense_recurring_templates_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expense_recurring_templates" ADD CONSTRAINT "expense_recurring_templates_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_recurring_template_fk" FOREIGN KEY ("tenant_id","recurring_template_id") REFERENCES "app"."expense_recurring_templates"("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_recurring_template_business_date_uidx" UNIQUE ("tenant_id","recurring_template_id","business_date");
--> statement-breakpoint
ALTER TABLE "app"."expenses" DROP CONSTRAINT IF EXISTS "expenses_recurring_template_immutable_guard";
CREATE OR REPLACE FUNCTION app.a13_expense_state_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state NOT IN ('DRAFT','SUBMITTED','RETURNED') AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
    NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.recurring_template_id IS DISTINCT FROM OLD.recurring_template_id OR
    NEW.business_date IS DISTINCT FROM OLD.business_date OR NEW.description IS DISTINCT FROM OLD.description OR
    NEW.category IS DISTINCT FROM OLD.category OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency OR
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
CREATE INDEX "expense_recurring_templates_scope_active_idx" ON "app"."expense_recurring_templates" USING btree ("tenant_id","legal_entity_id","station_id","active");
--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('expense.recurring.manage', 'Create, change, activate, and deactivate recurring expense rules')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('OWNER', 'expense.recurring.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE app.expense_recurring_templates ENABLE ROW LEVEL SECURITY;
  ALTER TABLE app.expense_recurring_templates FORCE ROW LEVEL SECURITY;
  CREATE POLICY expense_recurring_templates_tenant_context ON app.expense_recurring_templates
    USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.expense_recurring_templates OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.expense_recurring_templates TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.expense_recurring_templates TO diagnostics_readonly;
  END IF;
END
$$;
