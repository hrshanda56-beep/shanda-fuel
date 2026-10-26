ALTER TABLE "app"."expense_payments" DROP CONSTRAINT "expense_payments_source_ck";--> statement-breakpoint
ALTER TABLE "app"."expense_payments" ADD CONSTRAINT "expense_payments_source_ck"
  CHECK ("settlement_source" in ('CASH','BANK','REIMBURSEMENT','MOBILE_MONEY'));
