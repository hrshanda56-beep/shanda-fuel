CREATE TABLE "app"."expense_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"actor_membership_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_approvals_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_approvals_expense_actor_uidx" UNIQUE("tenant_id","expense_id","actor_membership_id"),
	CONSTRAINT "expense_approvals_decision_ck" CHECK ("app"."expense_approvals"."decision" in ('APPROVED','REJECTED')),
	CONSTRAINT "expense_approvals_reject_reason_ck" CHECK ("app"."expense_approvals"."decision" <> 'REJECTED' or btrim(coalesce("app"."expense_approvals"."reason", '')) <> '')
);
--> statement-breakpoint
CREATE TABLE "app"."expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"classification" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_categories_tenant_code_uidx" UNIQUE("tenant_id","code"),
	CONSTRAINT "expense_categories_code_nonempty_ck" CHECK (btrim("app"."expense_categories"."code") <> ''),
	CONSTRAINT "expense_categories_name_nonempty_ck" CHECK (btrim("app"."expense_categories"."name") <> ''),
	CONSTRAINT "expense_categories_classification_ck" CHECK ("app"."expense_categories"."classification" in ('OPERATING','FIXED_COST','DIRECT_INVENTORY_COST')),
	CONSTRAINT "expense_categories_status_ck" CHECK ("app"."expense_categories"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "app"."expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"expense_id" uuid,
	"recurring_period_id" uuid,
	"payment_date" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"settlement_source" text NOT NULL,
	"cash_movement_id" uuid,
	"external_reference" text,
	"state" text DEFAULT 'RECORDED' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "expense_payments_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_payments_currency_ck" CHECK ("app"."expense_payments"."currency" = 'USD'),
	CONSTRAINT "expense_payments_amount_positive_ck" CHECK ("app"."expense_payments"."amount" > 0),
	CONSTRAINT "expense_payments_source_ck" CHECK ("app"."expense_payments"."settlement_source" in ('CASH','BANK','REIMBURSEMENT')),
	CONSTRAINT "expense_payments_state_ck" CHECK ("app"."expense_payments"."state" in ('RECORDED','REVERSED')),
	CONSTRAINT "expense_payments_single_target_ck" CHECK (("app"."expense_payments"."expense_id" is not null) <> ("app"."expense_payments"."recurring_period_id" is not null)),
	CONSTRAINT "expense_payments_reference_ck" CHECK ("app"."expense_payments"."cash_movement_id" is not null or btrim(coalesce("app"."expense_payments"."external_reference", '')) <> ''),
	CONSTRAINT "expense_payments_cash_link_ck" CHECK ("app"."expense_payments"."cash_movement_id" is null or "app"."expense_payments"."settlement_source" = 'CASH'),
	CONSTRAINT "expense_payments_reversal_provenance_ck" CHECK ("app"."expense_payments"."state" <> 'REVERSED' or ("app"."expense_payments"."reversed_by" is not null and "app"."expense_payments"."reversed_at" is not null and btrim(coalesce("app"."expense_payments"."reversal_reason", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "app"."expense_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"step_up_threshold" numeric(20, 4),
	"second_approval_threshold" numeric(20, 4),
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_policies_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_policies_tenant_legal_entity_uidx" UNIQUE("tenant_id","legal_entity_id"),
	CONSTRAINT "expense_policies_thresholds_ck" CHECK (("app"."expense_policies"."step_up_threshold" is null or "app"."expense_policies"."step_up_threshold" >= 0)
        and ("app"."expense_policies"."second_approval_threshold" is null or "app"."expense_policies"."second_approval_threshold" > 0)
        and ("app"."expense_policies"."step_up_threshold" is null or "app"."expense_policies"."second_approval_threshold" is null or "app"."expense_policies"."second_approval_threshold" >= "app"."expense_policies"."step_up_threshold"))
);
--> statement-breakpoint
CREATE TABLE "app"."expense_recognition_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"movement_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"recognition_date" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"reversal_of_id" uuid,
	"actor_membership_id" uuid NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_recognition_movements_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_recognition_movements_source_uidx" UNIQUE("tenant_id","source_type","source_id","movement_type"),
	CONSTRAINT "expense_recognition_movements_classification_ck" CHECK ("app"."expense_recognition_movements"."classification" in ('OPERATING','FIXED_COST')),
	CONSTRAINT "expense_recognition_movements_type_ck" CHECK ("app"."expense_recognition_movements"."movement_type" in ('RECOGNITION','REVERSAL')),
	CONSTRAINT "expense_recognition_movements_source_type_ck" CHECK ("app"."expense_recognition_movements"."source_type" in ('EXPENSE','RECURRING_COST_RECOGNITION')),
	CONSTRAINT "expense_recognition_movements_currency_ck" CHECK ("app"."expense_recognition_movements"."currency" = 'USD'),
	CONSTRAINT "expense_recognition_movements_amount_positive_ck" CHECK ("app"."expense_recognition_movements"."amount" > 0),
	CONSTRAINT "expense_recognition_movements_reversal_ck" CHECK (("app"."expense_recognition_movements"."movement_type" = 'REVERSAL') = ("app"."expense_recognition_movements"."reversal_of_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"expense_date" text NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"reference" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"state" text DEFAULT 'SUBMITTED' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "expenses_tenant_station_id_id_uidx" UNIQUE("tenant_id","station_id","id"),
	CONSTRAINT "expenses_description_nonempty_ck" CHECK (btrim("app"."expenses"."description") <> ''),
	CONSTRAINT "expenses_currency_ck" CHECK ("app"."expenses"."currency" = 'USD'),
	CONSTRAINT "expenses_amount_positive_ck" CHECK ("app"."expenses"."amount" > 0),
	CONSTRAINT "expenses_required_approvals_ck" CHECK ("app"."expenses"."required_approvals" in (1,2)),
	CONSTRAINT "expenses_state_ck" CHECK ("app"."expenses"."state" in ('SUBMITTED','APPROVED','REJECTED','POSTED','REVERSED')),
	CONSTRAINT "expenses_rejection_provenance_ck" CHECK ("app"."expenses"."state" <> 'REJECTED' or ("app"."expenses"."rejected_by" is not null and "app"."expenses"."rejected_at" is not null and btrim(coalesce("app"."expenses"."rejection_reason", '')) <> '')),
	CONSTRAINT "expenses_post_provenance_ck" CHECK ("app"."expenses"."posted_at" is null or "app"."expenses"."posted_by" is not null),
	CONSTRAINT "expenses_reversal_provenance_ck" CHECK ("app"."expenses"."state" <> 'REVERSED' or ("app"."expenses"."reversed_by" is not null and "app"."expenses"."reversed_at" is not null and btrim(coalesce("app"."expenses"."reversal_reason", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "app"."recurring_cost_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"generated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_cost_periods_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_cost_periods_template_start_uidx" UNIQUE("tenant_id","template_id","period_start"),
	CONSTRAINT "recurring_cost_periods_currency_ck" CHECK ("app"."recurring_cost_periods"."currency" = 'USD'),
	CONSTRAINT "recurring_cost_periods_amount_positive_ck" CHECK ("app"."recurring_cost_periods"."amount" > 0),
	CONSTRAINT "recurring_cost_periods_dates_ck" CHECK ("app"."recurring_cost_periods"."period_end" >= "app"."recurring_cost_periods"."period_start")
);
--> statement-breakpoint
CREATE TABLE "app"."recurring_cost_recognitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"recognition_date" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"state" text DEFAULT 'RECOGNIZED' NOT NULL,
	"recognized_by" uuid NOT NULL,
	"recognized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "recurring_cost_recognitions_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_cost_recognitions_period_date_uidx" UNIQUE("tenant_id","period_id","recognition_date"),
	CONSTRAINT "recurring_cost_recognitions_currency_ck" CHECK ("app"."recurring_cost_recognitions"."currency" = 'USD'),
	CONSTRAINT "recurring_cost_recognitions_amount_positive_ck" CHECK ("app"."recurring_cost_recognitions"."amount" > 0),
	CONSTRAINT "recurring_cost_recognitions_state_ck" CHECK ("app"."recurring_cost_recognitions"."state" in ('RECOGNIZED','REVERSED')),
	CONSTRAINT "recurring_cost_recognitions_reversal_provenance_ck" CHECK ("app"."recurring_cost_recognitions"."state" <> 'REVERSED' or ("app"."recurring_cost_recognitions"."reversed_by" is not null and "app"."recurring_cost_recognitions"."reversed_at" is not null and btrim(coalesce("app"."recurring_cost_recognitions"."reversal_reason", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "app"."recurring_cost_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_cost_templates_tenant_id_id_uidx" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_cost_templates_tenant_station_name_uidx" UNIQUE("tenant_id","station_id","name"),
	CONSTRAINT "recurring_cost_templates_name_nonempty_ck" CHECK (btrim("app"."recurring_cost_templates"."name") <> ''),
	CONSTRAINT "recurring_cost_templates_frequency_ck" CHECK ("app"."recurring_cost_templates"."frequency" = 'MONTHLY'),
	CONSTRAINT "recurring_cost_templates_currency_ck" CHECK ("app"."recurring_cost_templates"."currency" = 'USD'),
	CONSTRAINT "recurring_cost_templates_amount_positive_ck" CHECK ("app"."recurring_cost_templates"."amount" > 0),
	CONSTRAINT "recurring_cost_templates_status_ck" CHECK ("app"."recurring_cost_templates"."status" in ('ACTIVE','INACTIVE')),
	CONSTRAINT "recurring_cost_templates_dates_ck" CHECK ("app"."recurring_cost_templates"."end_date" is null or "app"."recurring_cost_templates"."end_date" >= "app"."recurring_cost_templates"."start_date")
);
--> statement-breakpoint
ALTER TABLE "app"."expense_approvals" ADD CONSTRAINT "expense_approvals_expense_fk" FOREIGN KEY ("tenant_id","expense_id") REFERENCES "app"."expenses"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_approvals" ADD CONSTRAINT "expense_approvals_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_categories" ADD CONSTRAINT "expense_categories_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_expense_fk" FOREIGN KEY ("tenant_id","expense_id") REFERENCES "app"."expenses"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_period_fk" FOREIGN KEY ("tenant_id","recurring_period_id") REFERENCES "app"."recurring_cost_periods"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_cash_movement_fk" FOREIGN KEY ("tenant_id","cash_movement_id") REFERENCES "app"."cash_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_policies" ADD CONSTRAINT "expense_policies_legal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "app"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_policies" ADD CONSTRAINT "expense_policies_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_movements" ADD CONSTRAINT "expense_recognition_movements_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_movements" ADD CONSTRAINT "expense_recognition_movements_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."expense_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_movements" ADD CONSTRAINT "expense_recognition_movements_reversal_fk" FOREIGN KEY ("tenant_id","reversal_of_id") REFERENCES "app"."expense_recognition_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expense_recognition_movements" ADD CONSTRAINT "expense_recognition_movements_actor_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."expense_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_rejected_by_fk" FOREIGN KEY ("tenant_id","rejected_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_posted_by_fk" FOREIGN KEY ("tenant_id","posted_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_periods" ADD CONSTRAINT "recurring_cost_periods_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_periods" ADD CONSTRAINT "recurring_cost_periods_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "app"."recurring_cost_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_periods" ADD CONSTRAINT "recurring_cost_periods_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."expense_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_periods" ADD CONSTRAINT "recurring_cost_periods_generated_by_fk" FOREIGN KEY ("tenant_id","generated_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_recognitions" ADD CONSTRAINT "recurring_cost_recognitions_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_recognitions" ADD CONSTRAINT "recurring_cost_recognitions_period_fk" FOREIGN KEY ("tenant_id","period_id") REFERENCES "app"."recurring_cost_periods"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_recognitions" ADD CONSTRAINT "recurring_cost_recognitions_recognized_by_fk" FOREIGN KEY ("tenant_id","recognized_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_recognitions" ADD CONSTRAINT "recurring_cost_recognitions_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_templates" ADD CONSTRAINT "recurring_cost_templates_station_fk" FOREIGN KEY ("tenant_id","legal_entity_id","station_id") REFERENCES "app"."stations"("tenant_id","legal_entity_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_templates" ADD CONSTRAINT "recurring_cost_templates_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."expense_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."recurring_cost_templates" ADD CONSTRAINT "recurring_cost_templates_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "app"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expense_approvals_expense_idx" ON "app"."expense_approvals" USING btree ("tenant_id","expense_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payments_cash_movement_uidx" ON "app"."expense_payments" USING btree ("tenant_id","cash_movement_id") WHERE "app"."expense_payments"."cash_movement_id" is not null;
--> statement-breakpoint
CREATE INDEX "expense_payments_expense_idx" ON "app"."expense_payments" USING btree ("tenant_id","expense_id","state");
--> statement-breakpoint
CREATE INDEX "expense_payments_period_idx" ON "app"."expense_payments" USING btree ("tenant_id","recurring_period_id","state");
--> statement-breakpoint
CREATE INDEX "expense_recognition_movements_station_date_idx" ON "app"."expense_recognition_movements" USING btree ("tenant_id","station_id","recognition_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_tenant_station_reference_uidx" ON "app"."expenses" USING btree ("tenant_id","station_id","reference") WHERE "app"."expenses"."reference" is not null and "app"."expenses"."state" not in ('REJECTED','REVERSED');
--> statement-breakpoint
CREATE INDEX "expenses_tenant_station_date_idx" ON "app"."expenses" USING btree ("tenant_id","station_id","expense_date");
--> statement-breakpoint
CREATE INDEX "expenses_tenant_state_idx" ON "app"."expenses" USING btree ("tenant_id","state");
--> statement-breakpoint
CREATE INDEX "recurring_cost_periods_station_idx" ON "app"."recurring_cost_periods" USING btree ("tenant_id","station_id","period_start");
--> statement-breakpoint

-- Expenses (A6): hand-authored security, integrity, and authorization layer.
-- The statements above are the Drizzle-generated tables/constraints/indexes for
-- src/platform/db/schema/expenses.ts. Everything below is reviewed SQL that
-- Drizzle does not generate (permissions, guards, RLS, grants).

INSERT INTO platform.permission_definitions (code, description) VALUES
  ('expense.view', 'View expenses, recurring costs, and expense summaries'),
  ('expense.submit', 'Submit a station expense for approval'),
  ('expense.approve', 'Approve or reject a submitted expense'),
  ('expense.post', 'Post an approved expense so it is recognized as cost'),
  ('expense.reverse', 'Reverse a posted expense'),
  ('expense.payment.record', 'Record how a posted expense or recurring obligation was settled'),
  ('expense.payment.reverse', 'Reverse a recorded expense settlement'),
  ('expense.manage', 'Create and maintain expense categories'),
  ('expense.policy.manage', 'Set expense approval thresholds'),
  ('expense.recurring.manage', 'Create recurring-cost templates and generate period obligations'),
  ('expense.recurring.recognize', 'Recognize or reverse daily recurring-cost recognition')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT role_code, permission_code
FROM (VALUES
  ('OWNER', 'expense.view'), ('OWNER', 'expense.submit'), ('OWNER', 'expense.approve'),
  ('OWNER', 'expense.post'), ('OWNER', 'expense.reverse'), ('OWNER', 'expense.payment.record'),
  ('OWNER', 'expense.payment.reverse'), ('OWNER', 'expense.manage'),
  ('OWNER', 'expense.policy.manage'), ('OWNER', 'expense.recurring.manage'),
  ('OWNER', 'expense.recurring.recognize'),
  ('ADMINISTRATOR', 'expense.view'), ('ADMINISTRATOR', 'expense.submit'),
  ('ADMINISTRATOR', 'expense.approve'), ('ADMINISTRATOR', 'expense.post'),
  ('ADMINISTRATOR', 'expense.reverse'), ('ADMINISTRATOR', 'expense.payment.record'),
  ('ADMINISTRATOR', 'expense.payment.reverse'), ('ADMINISTRATOR', 'expense.manage'),
  ('ADMINISTRATOR', 'expense.policy.manage'), ('ADMINISTRATOR', 'expense.recurring.manage'),
  ('ADMINISTRATOR', 'expense.recurring.recognize'),
  ('FINANCE', 'expense.view'), ('FINANCE', 'expense.submit'), ('FINANCE', 'expense.approve'),
  ('FINANCE', 'expense.post'), ('FINANCE', 'expense.reverse'),
  ('FINANCE', 'expense.payment.record'), ('FINANCE', 'expense.payment.reverse'),
  ('FINANCE', 'expense.manage'), ('FINANCE', 'expense.recurring.manage'),
  ('FINANCE', 'expense.recurring.recognize'),
  ('SUPERVISOR', 'expense.view'), ('SUPERVISOR', 'expense.submit')
) AS grants(role_code, permission_code)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_expense_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_class text;
  category_status text;
BEGIN
  SELECT classification, status INTO category_class, category_status
  FROM app.expense_categories
  WHERE tenant_id = NEW.tenant_id AND id = NEW.category_id;
  IF category_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'expense category must be active';
  END IF;
  IF category_class = 'DIRECT_INVENTORY_COST' THEN
    RAISE EXCEPTION 'direct inventory cost belongs to landed cost and cannot be an operating expense';
  END IF;
  IF category_class <> 'OPERATING' THEN
    RAISE EXCEPTION 'manual expenses must use an OPERATING category; fixed costs use recurring costs';
  END IF;
  IF NEW.state <> 'SUBMITTED' OR NEW.version <> 0 THEN
    RAISE EXCEPTION 'expenses are created in the submitted state at version 0';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER expenses_insert_guard
BEFORE INSERT ON app.expenses
FOR EACH ROW EXECUTE FUNCTION app.a6_expense_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_expense_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approved_count integer;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
     NEW.station_id IS DISTINCT FROM OLD.station_id OR
     NEW.category_id IS DISTINCT FROM OLD.category_id OR
     NEW.expense_date IS DISTINCT FROM OLD.expense_date OR
     NEW.description IS DISTINCT FROM OLD.description OR
     NEW.payee IS DISTINCT FROM OLD.payee OR
     NEW.reference IS DISTINCT FROM OLD.reference OR
     NEW.currency IS DISTINCT FROM OLD.currency OR
     NEW.amount IS DISTINCT FROM OLD.amount OR
     NEW.required_approvals IS DISTINCT FROM OLD.required_approvals OR
     NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR
     NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'expense facts are immutable; use a named correction command';
  END IF;
  IF OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'submitted expenses can only be approved or rejected';
  END IF;
  IF OLD.state = 'APPROVED' AND NEW.state NOT IN ('APPROVED', 'POSTED') THEN
    RAISE EXCEPTION 'approved expenses can only be posted';
  END IF;
  IF OLD.state = 'POSTED' AND NEW.state NOT IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted expenses can only be reversed';
  END IF;
  IF OLD.state IN ('REJECTED', 'REVERSED') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'rejected and reversed expenses are terminal';
  END IF;
  IF NEW.state = 'APPROVED' AND OLD.state = 'SUBMITTED' THEN
    SELECT count(*) INTO approved_count
    FROM app.expense_approvals
    WHERE tenant_id = NEW.tenant_id AND expense_id = NEW.id AND decision = 'APPROVED';
    IF approved_count < NEW.required_approvals THEN
      RAISE EXCEPTION 'expense does not have the required number of approvals';
    END IF;
  END IF;
  IF NEW.state = 'REVERSED' AND OLD.state = 'POSTED' AND EXISTS (
    SELECT 1 FROM app.expense_payments
    WHERE tenant_id = NEW.tenant_id AND expense_id = NEW.id AND state = 'RECORDED'
  ) THEN
    RAISE EXCEPTION 'reverse recorded settlements before reversing the expense';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER expenses_state_guard
BEFORE UPDATE ON app.expenses
FOR EACH ROW EXECUTE FUNCTION app.a6_expense_state_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_expense_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expense_state text;
BEGIN
  SELECT state INTO expense_state
  FROM app.expenses
  WHERE tenant_id = NEW.tenant_id AND id = NEW.expense_id
  FOR UPDATE;
  IF expense_state IS DISTINCT FROM 'SUBMITTED' THEN
    RAISE EXCEPTION 'approval decisions can only be recorded on submitted expenses';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER expense_approvals_guard
BEFORE INSERT ON app.expense_approvals
FOR EACH ROW EXECUTE FUNCTION app.a6_expense_approval_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_recurring_template_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_class text;
  category_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
       NEW.station_id IS DISTINCT FROM OLD.station_id OR
       NEW.category_id IS DISTINCT FROM OLD.category_id OR
       NEW.frequency IS DISTINCT FROM OLD.frequency OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW.start_date IS DISTINCT FROM OLD.start_date THEN
      RAISE EXCEPTION 'recurring cost template facts are immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT classification, status INTO category_class, category_status
  FROM app.expense_categories
  WHERE tenant_id = NEW.tenant_id AND id = NEW.category_id;
  IF category_status IS DISTINCT FROM 'ACTIVE' OR category_class IS DISTINCT FROM 'FIXED_COST' THEN
    RAISE EXCEPTION 'recurring costs require an active FIXED_COST category';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER recurring_cost_templates_guard
BEFORE INSERT OR UPDATE ON app.recurring_cost_templates
FOR EACH ROW EXECUTE FUNCTION app.a6_recurring_template_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_recurring_period_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_row app.recurring_cost_templates%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
       NEW.station_id IS DISTINCT FROM OLD.station_id OR
       NEW.template_id IS DISTINCT FROM OLD.template_id OR
       NEW.category_id IS DISTINCT FROM OLD.category_id OR
       NEW.period_start IS DISTINCT FROM OLD.period_start OR
       NEW.period_end IS DISTINCT FROM OLD.period_end OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'recurring cost period facts are immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO template_row
  FROM app.recurring_cost_templates
  WHERE tenant_id = NEW.tenant_id AND id = NEW.template_id;
  IF template_row.id IS NULL OR template_row.status <> 'ACTIVE'
     OR template_row.station_id <> NEW.station_id
     OR template_row.category_id <> NEW.category_id
     OR template_row.amount <> NEW.amount THEN
    RAISE EXCEPTION 'recurring cost period must snapshot an active template';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER recurring_cost_periods_guard
BEFORE INSERT OR UPDATE ON app.recurring_cost_periods
FOR EACH ROW EXECUTE FUNCTION app.a6_recurring_period_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_recurring_recognition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period_row app.recurring_cost_periods%ROWTYPE;
  recognized_total numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
       NEW.station_id IS DISTINCT FROM OLD.station_id OR
       NEW.period_id IS DISTINCT FROM OLD.period_id OR
       NEW.recognition_date IS DISTINCT FROM OLD.recognition_date OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW.recognized_by IS DISTINCT FROM OLD.recognized_by OR
       NEW.recognized_at IS DISTINCT FROM OLD.recognized_at THEN
      RAISE EXCEPTION 'recurring cost recognition facts are immutable';
    END IF;
    IF OLD.state = 'REVERSED' OR NEW.state NOT IN ('RECOGNIZED', 'REVERSED') THEN
      RAISE EXCEPTION 'reversed recognitions are terminal';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO period_row
  FROM app.recurring_cost_periods
  WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id
  FOR UPDATE;
  IF period_row.id IS NULL OR period_row.station_id <> NEW.station_id THEN
    RAISE EXCEPTION 'recognition must belong to an existing period at the same station';
  END IF;
  IF NEW.recognition_date < period_row.period_start OR NEW.recognition_date > period_row.period_end THEN
    RAISE EXCEPTION 'recognition date must fall inside the period';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO recognized_total
  FROM app.recurring_cost_recognitions
  WHERE tenant_id = NEW.tenant_id AND period_id = NEW.period_id AND state = 'RECOGNIZED';
  IF recognized_total + NEW.amount > period_row.amount THEN
    RAISE EXCEPTION 'recognition would exceed the period obligation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER recurring_cost_recognitions_guard
BEFORE INSERT OR UPDATE ON app.recurring_cost_recognitions
FOR EACH ROW EXECUTE FUNCTION app.a6_recurring_recognition_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_expense_payment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_amount numeric;
  target_station uuid;
  target_state text;
  settled_total numeric;
  movement_row app.cash_movements%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
       NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
       NEW.station_id IS DISTINCT FROM OLD.station_id OR
       NEW.expense_id IS DISTINCT FROM OLD.expense_id OR
       NEW.recurring_period_id IS DISTINCT FROM OLD.recurring_period_id OR
       NEW.payment_date IS DISTINCT FROM OLD.payment_date OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW.settlement_source IS DISTINCT FROM OLD.settlement_source OR
       NEW.cash_movement_id IS DISTINCT FROM OLD.cash_movement_id OR
       NEW.external_reference IS DISTINCT FROM OLD.external_reference OR
       NEW.recorded_by IS DISTINCT FROM OLD.recorded_by OR
       NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
      RAISE EXCEPTION 'expense settlement facts are immutable';
    END IF;
    IF OLD.state = 'REVERSED' OR NEW.state NOT IN ('RECORDED', 'REVERSED') THEN
      RAISE EXCEPTION 'reversed expense settlements are terminal';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state <> 'RECORDED' THEN
    RAISE EXCEPTION 'expense settlements are created as recorded';
  END IF;
  IF NEW.expense_id IS NOT NULL THEN
    SELECT amount, station_id, state INTO target_amount, target_station, target_state
    FROM app.expenses
    WHERE tenant_id = NEW.tenant_id AND id = NEW.expense_id
    FOR UPDATE;
    IF target_state IS DISTINCT FROM 'POSTED' THEN
      RAISE EXCEPTION 'only posted expenses can be settled';
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO settled_total
    FROM app.expense_payments
    WHERE tenant_id = NEW.tenant_id AND expense_id = NEW.expense_id AND state = 'RECORDED';
  ELSE
    SELECT amount, station_id, 'POSTED' INTO target_amount, target_station, target_state
    FROM app.recurring_cost_periods
    WHERE tenant_id = NEW.tenant_id AND id = NEW.recurring_period_id
    FOR UPDATE;
    SELECT COALESCE(sum(amount), 0) INTO settled_total
    FROM app.expense_payments
    WHERE tenant_id = NEW.tenant_id AND recurring_period_id = NEW.recurring_period_id
      AND state = 'RECORDED';
  END IF;
  IF target_amount IS NULL OR target_station <> NEW.station_id THEN
    RAISE EXCEPTION 'settlement target was not found at the settlement station';
  END IF;
  IF settled_total + NEW.amount > target_amount THEN
    RAISE EXCEPTION 'settlement would exceed the outstanding obligation';
  END IF;
  IF NEW.cash_movement_id IS NOT NULL THEN
    SELECT * INTO movement_row
    FROM app.cash_movements
    WHERE tenant_id = NEW.tenant_id AND id = NEW.cash_movement_id;
    IF movement_row.id IS NULL
       OR movement_row.movement_type <> 'DISBURSEMENT'
       OR movement_row.station_id <> NEW.station_id
       OR movement_row.amount <> NEW.amount THEN
      RAISE EXCEPTION 'linked cash movement must be a matching disbursement at the same station';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER expense_payments_guard
BEFORE INSERT OR UPDATE ON app.expense_payments
FOR EACH ROW EXECUTE FUNCTION app.a6_expense_payment_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.a6_expense_recognition_movement_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original app.expense_recognition_movements%ROWTYPE;
BEGIN
  IF NEW.movement_type = 'REVERSAL' THEN
    SELECT * INTO original
    FROM app.expense_recognition_movements
    WHERE tenant_id = NEW.tenant_id AND id = NEW.reversal_of_id;
    IF original.id IS NULL
       OR original.movement_type <> 'RECOGNITION'
       OR original.source_type <> NEW.source_type
       OR original.source_id <> NEW.source_id
       OR original.station_id <> NEW.station_id
       OR original.category_id <> NEW.category_id
       OR original.amount <> NEW.amount THEN
      RAISE EXCEPTION 'recognition reversal must identify and match its recognition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER expense_recognition_movements_guard
BEFORE INSERT ON app.expense_recognition_movements
FOR EACH ROW EXECUTE FUNCTION app.a6_expense_recognition_movement_guard();
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'expense_categories', 'expense_policies', 'expenses', 'expense_approvals',
    'recurring_cost_templates', 'recurring_cost_periods', 'recurring_cost_recognitions',
    'expense_payments', 'expense_recognition_movements'
  ] LOOP
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
    GRANT SELECT, INSERT, UPDATE ON
      app.expense_categories, app.expense_policies, app.expenses,
      app.recurring_cost_templates, app.recurring_cost_periods,
      app.recurring_cost_recognitions, app.expense_payments
    TO app_runtime;
    GRANT SELECT, INSERT ON app.expense_approvals, app.expense_recognition_movements
    TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON
      app.expense_categories, app.expense_policies, app.expenses, app.expense_approvals,
      app.recurring_cost_templates, app.recurring_cost_periods,
      app.recurring_cost_recognitions, app.expense_payments,
      app.expense_recognition_movements
    TO diagnostics_readonly;
  END IF;
END
$$;
--> statement-breakpoint

-- Approval decisions and the recognition ledger are facts: corrections are new rows.
-- No expense table is ever deleted from by the runtime role.
REVOKE UPDATE ON app.expense_approvals, app.expense_recognition_movements FROM app_runtime;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON
  app.expense_categories, app.expense_policies, app.expenses, app.expense_approvals,
  app.recurring_cost_templates, app.recurring_cost_periods, app.recurring_cost_recognitions,
  app.expense_payments, app.expense_recognition_movements
FROM app_runtime;
