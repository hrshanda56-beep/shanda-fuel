-- A credit customer's usual days to pay. Informational: it is recorded and shown, and never blocks
-- a sale. Nullable, so existing accounts keep working and a missing value means "not agreed".
ALTER TABLE "app"."customer_accounts" ADD COLUMN "credit_days" integer;
--> statement-breakpoint
ALTER TABLE "app"."customer_accounts" ADD CONSTRAINT "customer_accounts_credit_days_ck"
  CHECK ("credit_days" IS NULL OR ("account_type" = 'CREDIT' AND "credit_days" BETWEEN 0 AND 365));
