-- What each EcoCash or POS account charges: a percentage of every settlement and/or a fixed fee.
-- A settlement uses it to work out the charge it should have, and shows any difference from what
-- the provider actually kept, so charges no longer have to be typed in as expenses. Nothing is
-- rewritten: accounts without a fee behave as before.
ALTER TABLE "app"."provider_accounts" ADD COLUMN "fee_percent" numeric(9, 4);
--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD COLUMN "fee_fixed" numeric(20, 4);
--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_fee_percent_ck"
  CHECK ("fee_percent" IS NULL OR ("fee_percent" >= 0 AND "fee_percent" <= 100));
--> statement-breakpoint
ALTER TABLE "app"."provider_accounts" ADD CONSTRAINT "provider_accounts_fee_fixed_ck"
  CHECK ("fee_fixed" IS NULL OR "fee_fixed" >= 0);
--> statement-breakpoint
ALTER TABLE "app"."provider_settlements" ADD COLUMN "expected_fee_amount" numeric(20, 4);
--> statement-breakpoint
ALTER TABLE "app"."provider_settlements" ADD CONSTRAINT "provider_settlements_expected_fee_ck"
  CHECK ("expected_fee_amount" IS NULL OR "expected_fee_amount" >= 0);
