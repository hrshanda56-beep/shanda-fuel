-- S13: staff fuel benefit. A staff benefit account is an ordinary CREDIT account (same ledger,
-- statement and ageing) that is marked here as a staff member's benefit. Its period limit is the
-- account's `credit_limit`, so changing it still goes through the credit-limit override approval
-- flow (0061). This table only records who the benefit is for and how the limit is measured.
-- PROPOSED default (docs/DECISIONS.md): monthly period, USD limit. Litre limits are not built.
-- Append-only: the marker never changes once the account exists.
CREATE TABLE "app"."customer_staff_benefit_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "staff_name" text NOT NULL,
  "staff_membership_id" uuid,
  "period_kind" text DEFAULT 'MONTHLY' NOT NULL,
  "limit_basis" text DEFAULT 'USD' NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_staff_benefit_terms_tenant_id_id_uidx" UNIQUE("tenant_id", "id"),
  CONSTRAINT "customer_staff_benefit_terms_account_uidx" UNIQUE("tenant_id", "account_id"),
  CONSTRAINT "customer_staff_benefit_terms_name_ck" CHECK (btrim("staff_name") <> '' AND char_length("staff_name") <= 200),
  CONSTRAINT "customer_staff_benefit_terms_period_ck" CHECK ("period_kind" IN ('MONTHLY')),
  CONSTRAINT "customer_staff_benefit_terms_basis_ck" CHECK ("limit_basis" IN ('USD'))
);
--> statement-breakpoint
ALTER TABLE "app"."customer_staff_benefit_terms" ADD CONSTRAINT "customer_staff_benefit_terms_account_fk"
  FOREIGN KEY ("tenant_id", "account_id") REFERENCES "app"."customer_accounts"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_staff_benefit_terms" ADD CONSTRAINT "customer_staff_benefit_terms_staff_fk"
  FOREIGN KEY ("tenant_id", "staff_membership_id") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."customer_staff_benefit_terms" ADD CONSTRAINT "customer_staff_benefit_terms_created_by_fk"
  FOREIGN KEY ("tenant_id", "created_by") REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION app.customer_staff_benefit_terms_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'staff benefit terms are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_staff_benefit_terms_append_only
BEFORE UPDATE OR DELETE ON app.customer_staff_benefit_terms
FOR EACH ROW EXECUTE FUNCTION app.customer_staff_benefit_terms_append_only();
--> statement-breakpoint
ALTER TABLE app.customer_staff_benefit_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customer_staff_benefit_terms FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_staff_benefit_terms_tenant_context ON app.customer_staff_benefit_terms
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.customer_staff_benefit_terms OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.customer_staff_benefit_terms TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.customer_staff_benefit_terms FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.customer_staff_benefit_terms TO diagnostics_readonly;
  END IF;
END
$$;
