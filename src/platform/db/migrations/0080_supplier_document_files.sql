-- A supplier invoice or credit note can carry the supplier's own paper or PDF. The file is an
-- ordinary app.documents row attached to the document (subject type SUPPLIER_DOCUMENT, subject id =
-- the supplier document id), so nothing is added to the supplier document itself and posted
-- documents are never touched. Only the allowed subject types change; RLS/FORCE RLS on
-- app.documents is unchanged.
ALTER TABLE "app"."documents" DROP CONSTRAINT "documents_subject_type_ck";
--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_subject_type_ck" CHECK ("subject_type" in (
  'FUEL_DELIVERY', 'BANK_DEPOSIT', 'CASH_HANDOVER', 'RECONCILIATION', 'EXPENSE', 'SUPPLIER_PAYMENT',
  'SUPPLIER_DOCUMENT'
));
