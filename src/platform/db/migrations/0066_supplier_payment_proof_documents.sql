-- Supplier payment proofs are legal-entity-scoped evidence.  Existing operational
-- documents remain station-scoped; the nullable station_id is only valid for this
-- new subject/kind pair.  The table remains append-only and tenant/RLS protected.
ALTER TABLE app.documents
  DROP CONSTRAINT IF EXISTS documents_subject_type_ck,
  DROP CONSTRAINT IF EXISTS documents_kind_ck,
  DROP CONSTRAINT IF EXISTS documents_station_fk;
--> statement-breakpoint
ALTER TABLE app.documents
  ALTER COLUMN station_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.documents
  ADD CONSTRAINT documents_subject_type_ck CHECK (subject_type in (
    'FUEL_DELIVERY', 'BANK_DEPOSIT', 'CASH_HANDOVER', 'RECONCILIATION', 'EXPENSE',
    'SUPPLIER_PAYMENT'
  )),
  ADD CONSTRAINT documents_kind_ck CHECK (kind in (
    'INVOICE', 'DELIVERY_NOTE', 'DEPOSIT_SLIP', 'PAYMENT_PROOF', 'RECEIPT', 'PHOTO', 'OTHER'
  )),
  ADD CONSTRAINT documents_subject_scope_ck CHECK (
    (subject_type = 'SUPPLIER_PAYMENT' and station_id is null and kind = 'PAYMENT_PROOF')
    or
    (subject_type <> 'SUPPLIER_PAYMENT' and station_id is not null and kind <> 'PAYMENT_PROOF')
  );
--> statement-breakpoint
ALTER TABLE app.documents
  ADD CONSTRAINT documents_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations (tenant_id, legal_entity_id, id),
  ADD CONSTRAINT documents_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities (tenant_id, id);
--> statement-breakpoint
CREATE INDEX documents_legal_entity_subject_idx
  ON app.documents (tenant_id, legal_entity_id, subject_type, subject_id);
