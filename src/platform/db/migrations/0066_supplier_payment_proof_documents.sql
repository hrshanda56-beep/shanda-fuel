-- TEI Oils S9: a supplier payment can carry proof of payment. The proof is an ordinary
-- app.documents row attached to the payment (subject type SUPPLIER_PAYMENT, subject id = the
-- supplier payment id), so no column is added to the payment itself and posted payments are
-- never touched. Only the allowed subject types change; RLS/FORCE RLS on app.documents is
-- unchanged.
ALTER TABLE "app"."documents" DROP CONSTRAINT "documents_subject_type_ck";
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_subject_type_ck" CHECK ("subject_type" in (
  'FUEL_DELIVERY', 'BANK_DEPOSIT', 'CASH_HANDOVER', 'RECONCILIATION', 'EXPENSE', 'SUPPLIER_PAYMENT'
));
