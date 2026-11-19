-- "Paid with: Other" on an expense. The person says how it was paid, and that text is kept.
-- Additive: older rows are untouched. Other is not station cash, so it never changes the cash to collect.
-- Local development databases until approved.
ALTER TABLE "app"."expenses" DROP CONSTRAINT "expenses_payment_method_ck";
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD COLUMN "payment_method_other" text;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_payment_method_ck"
  CHECK ("payment_method" IS NULL OR "payment_method" IN ('STATION_CASH','ECOCASH','BANK','CARD','OTHER'));
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_payment_method_other_ck" CHECK (
  CASE WHEN "payment_method" = 'OTHER'
    THEN btrim(coalesce("payment_method_other", '')) <> '' AND char_length("payment_method_other") <= 60
    ELSE "payment_method_other" IS NULL
  END
);
