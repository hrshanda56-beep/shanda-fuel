-- Supplier invoices: cash or credit, and the credit period that fixes the due date.
-- Hand-authored and additive. Existing rows keep NULL terms ("not recorded") and their typed
-- due date, so nothing is rewritten. RLS, FORCE RLS and grants on supplier_documents are
-- untouched (ADD COLUMN and CHECK only).

ALTER TABLE "app"."supplier_documents"
  ADD COLUMN "payment_terms" text,
  ADD COLUMN "credit_period_days" integer;
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents"
  ADD CONSTRAINT "supplier_documents_payment_terms_ck"
  CHECK ("payment_terms" IS NULL OR "payment_terms" IN ('CASH','CREDIT'));
--> statement-breakpoint
ALTER TABLE "app"."supplier_documents"
  ADD CONSTRAINT "supplier_documents_credit_period_ck"
  CHECK ("credit_period_days" IS NULL OR ("credit_period_days" >= 0 AND "credit_period_days" <= 365));
--> statement-breakpoint
-- Terms belong on invoices only. Cash has neither a period nor a due date. Credit has a due
-- date, and when a period is recorded the due date is exactly document date + period days.
ALTER TABLE "app"."supplier_documents"
  ADD CONSTRAINT "supplier_documents_terms_shape_ck"
  CHECK (
    ("payment_terms" IS NULL AND "credit_period_days" IS NULL)
    OR ("document_type" = 'INVOICE' AND "payment_terms" = 'CASH'
        AND "credit_period_days" IS NULL AND "due_date" IS NULL)
    OR ("document_type" = 'INVOICE' AND "payment_terms" = 'CREDIT' AND "due_date" IS NOT NULL
        AND ("credit_period_days" IS NULL
             OR "due_date" = to_char(("document_date")::date + "credit_period_days", 'YYYY-MM-DD')))
  );
--> statement-breakpoint

-- Cash/credit terms are facts once the document leaves submission, like the due date they set.
CREATE OR REPLACE FUNCTION app.a7_supplier_document_terms_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state NOT IN ('DRAFT', 'SUBMITTED') AND (
    NEW.payment_terms IS DISTINCT FROM OLD.payment_terms OR
    NEW.credit_period_days IS DISTINCT FROM OLD.credit_period_days
  ) THEN
    RAISE EXCEPTION 'finalized supplier document terms are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_documents_terms_guard
BEFORE UPDATE ON app.supplier_documents
FOR EACH ROW EXECUTE FUNCTION app.a7_supplier_document_terms_guard();
