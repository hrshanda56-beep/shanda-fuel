-- How an expense was paid, said when it is entered: station cash, EcoCash, bank or card.
-- Nothing is rewritten: older expenses simply have no method. Station cash that was paid out
-- is taken off the cash available for collection (see the cash summary).
ALTER TABLE "app"."expenses" ADD COLUMN "payment_method" text;
--> statement-breakpoint
ALTER TABLE "app"."expenses" ADD CONSTRAINT "expenses_payment_method_ck"
  CHECK ("payment_method" IS NULL OR "payment_method" IN ('STATION_CASH','ECOCASH','BANK','CARD'));
