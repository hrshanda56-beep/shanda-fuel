-- A supplier's contact person and usual credit period. Additive and nullable: existing
-- suppliers keep working, and a missing value means "not recorded", never zero days.
-- The invoice-level cash/credit choice (0066) is unchanged; this only pre-fills it.
ALTER TABLE "app"."suppliers" ADD COLUMN "contact_name" text;
--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD COLUMN "contact_phone" text;
--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD COLUMN "contact_email" text;
--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD COLUMN "default_credit_days" integer;
--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD CONSTRAINT "suppliers_default_credit_days_ck"
  CHECK ("default_credit_days" IS NULL OR "default_credit_days" BETWEEN 0 AND 365);
