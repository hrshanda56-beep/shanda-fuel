-- Delivery loss recovery: an amount expected back when a claim is raised, how a settlement is paid,
-- and an approval step (DEC-055). Additive only. Nothing here posts to any ledger; the accounting
-- treatment waits for Finance. Local development databases until approved.

ALTER TABLE "app"."fuel_delivery_loss_claims"
  ADD COLUMN "expected_amount" numeric(20, 4),
  ADD COLUMN "settlement_method" text,
  ADD COLUMN "approval_status" text,
  ADD COLUMN "approved_by" uuid,
  ADD COLUMN "approved_at" timestamp with time zone,
  ADD COLUMN "approval_note" text;
--> statement-breakpoint
UPDATE "app"."fuel_delivery_loss_claims"
  SET "approval_status" = CASE WHEN "status" = 'NONE' THEN 'NOT_NEEDED' ELSE 'PENDING' END;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_loss_claims" ALTER COLUMN "approval_status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_loss_claims"
  ADD CONSTRAINT "fuel_delivery_loss_claims_expected_ck" CHECK ("expected_amount" IS NULL OR "expected_amount" > 0),
  ADD CONSTRAINT "fuel_delivery_loss_claims_method_ck" CHECK (
    "settlement_method" IS NULL OR "settlement_method" IN ('CASH', 'TRANSPORT_BILL', 'SUPPLIER_BALANCE')
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_method_settled_ck" CHECK (
    ("status" = 'SETTLED') = ("settlement_method" IS NOT NULL)
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_approval_ck" CHECK (
    "approval_status" IN ('NOT_NEEDED', 'PENDING', 'APPROVED', 'REJECTED')
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_approval_pair_ck" CHECK (
    ("status" = 'NONE') = ("approval_status" = 'NOT_NEEDED')
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_decision_ck" CHECK (
    ("approval_status" IN ('APPROVED', 'REJECTED')) = ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_other_person_ck" CHECK (
    "approved_by" IS NULL OR "approved_by" <> "updated_by"
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_approval_note_ck" CHECK (
    "approval_note" IS NULL OR char_length("approval_note") <= 500
  ),
  ADD CONSTRAINT "fuel_delivery_loss_claims_currency_needed_ck" CHECK (
    ("expected_amount" IS NULL AND "recovered_amount" IS NULL) OR "currency" IS NOT NULL
  );
--> statement-breakpoint
ALTER TABLE "app"."fuel_delivery_loss_claims" ADD CONSTRAINT "fuel_delivery_loss_claims_approved_by_fk"
  FOREIGN KEY ("tenant_id", "approved_by")
  REFERENCES "app"."memberships"("tenant_id", "id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description) VALUES
  ('delivery.loss.record', 'Record who is held responsible for a delivery loss, the amount expected back and how it was settled'),
  ('delivery.loss.approve', 'Approve or send back a delivery loss claim or its settlement')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'delivery.loss.record'), ('OWNER', 'delivery.loss.approve'),
  ('ADMINISTRATOR', 'delivery.loss.record'), ('ADMINISTRATOR', 'delivery.loss.approve'),
  ('FINANCE', 'delivery.loss.record'),
  ('SUPERVISOR', 'delivery.loss.record'),
  ('AREA_MANAGER', 'delivery.loss.record')
ON CONFLICT DO NOTHING;
