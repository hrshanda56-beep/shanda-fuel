ALTER TABLE "app"."suppliers"
  ADD COLUMN "credit_limit" numeric(20, 4);
--> statement-breakpoint
ALTER TABLE "app"."suppliers"
  ADD CONSTRAINT "suppliers_credit_limit_ck" CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0);
