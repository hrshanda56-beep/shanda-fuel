-- Record how a supplier payment was made and, for bank payments, which active
-- tenant/legal-entity bank account was used. Both fields remain nullable so
-- historical payments and existing API clients remain valid.
ALTER TABLE app.supplier_payments
  ADD COLUMN bank_account_id uuid;
--> statement-breakpoint
ALTER TABLE app.supplier_payments
  ADD CONSTRAINT supplier_payments_bank_account_fk
  FOREIGN KEY (tenant_id, bank_account_id)
  REFERENCES app.bank_accounts (tenant_id, id);
--> statement-breakpoint
ALTER TABLE app.supplier_payments
  ADD CONSTRAINT supplier_payments_payment_method_ck
  CHECK (payment_method IS NULL OR payment_method IN ('STATION_CASH','ECOCASH','BANK','CARD'));
--> statement-breakpoint
CREATE INDEX supplier_payments_tenant_bank_account_idx
  ON app.supplier_payments (tenant_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL;
