-- When the bank confirms a deposit, the person records the bank's date and, when the amount the
-- bank confirmed differs from the amount deposited, why. Both are optional columns on the deposit;
-- existing deposits keep NULL and are unaffected. The application requires the reason whenever a
-- difference is recorded.
ALTER TABLE app.bank_deposits
  ADD COLUMN IF NOT EXISTS bank_date text,
  ADD COLUMN IF NOT EXISTS confirmation_reason text;
--> statement-breakpoint
ALTER TABLE app.bank_deposits
  ADD CONSTRAINT bank_deposits_bank_date_ck
  CHECK (bank_date IS NULL OR bank_date ~ '^\d{4}-\d{2}-\d{2}$');
