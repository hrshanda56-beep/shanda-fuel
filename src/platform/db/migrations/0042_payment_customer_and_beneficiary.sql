ALTER TABLE "app"."reconciliation_payments"
  ADD COLUMN "customer_account_id" uuid,
  ADD COLUMN "beneficiary_name" text;
--> statement-breakpoint
ALTER TABLE "app"."reconciliation_payments"
  ADD CONSTRAINT "reconciliation_payments_customer_account_fk"
  FOREIGN KEY ("tenant_id", "customer_account_id")
  REFERENCES "app"."customer_accounts"("tenant_id", "id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reconciliation_payments_customer_account_idx"
  ON "app"."reconciliation_payments" USING btree ("tenant_id", "customer_account_id")
  WHERE "customer_account_id" IS NOT NULL;
