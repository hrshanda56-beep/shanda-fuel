-- SUPERSEDED HISTORICAL DESIGN NOTE — NOT A LIVE MIGRATION.
--
-- The canonical production schema is now:
--   0004_a4_inventory.sql (tanks, dips, deliveries, movements)
--   0005_daily_reconciliation.sql (A3/A5 reconciliation evidence/workflow)
--
-- This pre-A4 proposal is retained only for historical context. Its duplicate
-- reconciliation_deliveries, reconciliation_tank_dips, and cash/inventory
-- ownership model must not be applied or treated as the current architecture.
-- A5 references canonical A4 entities and posts A4 inventory movements.
-- A0 owns the canonical migration sequence in src/platform/db/migrations/.
-- All SQL below remains unexecuted historical proposal text.

-- Historical proposal: a reconciliation is shift-scoped. The live cutover is
-- implemented by canonical migration 0005.
ALTER TABLE app.reconciliations
  ADD COLUMN IF NOT EXISTS shift_id uuid,
  ADD COLUMN IF NOT EXISTS supervisor_id uuid;

ALTER TABLE app.reconciliations
  DROP CONSTRAINT IF EXISTS reconciliations_business_day_uidx;

ALTER TABLE app.reconciliations
  ADD CONSTRAINT reconciliations_shift_fk
    FOREIGN KEY (tenant_id, station_id, shift_id)
    REFERENCES app.shifts (tenant_id, station_id, id),
  ADD CONSTRAINT reconciliations_supervisor_fk
    FOREIGN KEY (tenant_id, supervisor_id)
    REFERENCES app.memberships (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS reconciliations_shift_uidx
  ON app.reconciliations (tenant_id, station_id, shift_id)
  WHERE shift_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.reconciliation_attendants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  attendant_id uuid NOT NULL,
  assigned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_attendants_scope_uidx UNIQUE (tenant_id, station_id, id),
  CONSTRAINT reconciliation_attendants_member_uidx UNIQUE (tenant_id, station_id, reconciliation_id, attendant_id),
  CONSTRAINT reconciliation_attendants_reconciliation_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id)
    REFERENCES app.reconciliations (tenant_id, station_id, id),
  CONSTRAINT reconciliation_attendants_attendant_fk FOREIGN KEY (tenant_id, attendant_id)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT reconciliation_attendants_assigned_by_fk FOREIGN KEY (tenant_id, assigned_by)
    REFERENCES app.memberships (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS app.reconciliation_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(20, 4) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL,
  person_paid text,
  approval_reference text,
  document_reference text,
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_expenses_scope_uidx UNIQUE (tenant_id, station_id, id),
  CONSTRAINT reconciliation_expenses_reconciliation_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id)
    REFERENCES app.reconciliations (tenant_id, station_id, id),
  CONSTRAINT reconciliation_expenses_entered_by_fk FOREIGN KEY (tenant_id, entered_by)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT reconciliation_expenses_amount_ck CHECK (amount >= 0),
  CONSTRAINT reconciliation_expenses_currency_ck CHECK (currency = 'USD'),
  CONSTRAINT reconciliation_expenses_payment_method_ck CHECK (payment_method IN ('CASH', 'POS', 'ECOCASH', 'BANK_TRANSFER', 'CUSTOMER_CREDIT', 'PREPAID', 'STAFF_OR_MANAGEMENT_FUEL', 'OTHER_APPROVED'))
);

CREATE TABLE IF NOT EXISTS app.reconciliation_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  product_id uuid NOT NULL,
  tank_id uuid NOT NULL,
  quantity_litres numeric(18, 3) NOT NULL,
  delivery_reference text NOT NULL,
  supplier_reference text,
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_deliveries_scope_uidx UNIQUE (tenant_id, station_id, id),
  CONSTRAINT reconciliation_deliveries_reconciliation_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id)
    REFERENCES app.reconciliations (tenant_id, station_id, id),
  CONSTRAINT reconciliation_deliveries_product_fk FOREIGN KEY (tenant_id, product_id)
    REFERENCES app.products (tenant_id, id),
  CONSTRAINT reconciliation_deliveries_tank_fk FOREIGN KEY (tenant_id, station_id, tank_id)
    REFERENCES app.tanks (tenant_id, station_id, id),
  CONSTRAINT reconciliation_deliveries_entered_by_fk FOREIGN KEY (tenant_id, entered_by)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT reconciliation_deliveries_quantity_ck CHECK (quantity_litres > 0)
);

CREATE TABLE IF NOT EXISTS app.reconciliation_tank_dips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  tank_id uuid NOT NULL,
  product_id uuid NOT NULL,
  opening_litres numeric(18, 3),
  closing_litres numeric(18, 3) NOT NULL,
  adjustment_litres numeric(18, 3) NOT NULL DEFAULT 0,
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_tank_dips_scope_uidx UNIQUE (tenant_id, station_id, id),
  CONSTRAINT reconciliation_tank_dips_one_per_tank_uidx UNIQUE (tenant_id, station_id, reconciliation_id, tank_id),
  CONSTRAINT reconciliation_tank_dips_reconciliation_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id)
    REFERENCES app.reconciliations (tenant_id, station_id, id),
  CONSTRAINT reconciliation_tank_dips_product_fk FOREIGN KEY (tenant_id, product_id)
    REFERENCES app.products (tenant_id, id),
  CONSTRAINT reconciliation_tank_dips_tank_fk FOREIGN KEY (tenant_id, station_id, tank_id)
    REFERENCES app.tanks (tenant_id, station_id, id),
  CONSTRAINT reconciliation_tank_dips_entered_by_fk FOREIGN KEY (tenant_id, entered_by)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT reconciliation_tank_dips_closing_ck CHECK (closing_litres >= 0),
  CONSTRAINT reconciliation_tank_dips_opening_ck CHECK (opening_litres IS NULL OR opening_litres >= 0)
);

CREATE TABLE IF NOT EXISTS app.reconciliation_cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  station_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  counted_cash numeric(20, 4) NOT NULL,
  handover_amount numeric(20, 4),
  currency text NOT NULL DEFAULT 'USD',
  explanation text,
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_cash_counts_scope_uidx UNIQUE (tenant_id, station_id, id),
  CONSTRAINT reconciliation_cash_counts_reconciliation_uidx UNIQUE (tenant_id, station_id, reconciliation_id),
  CONSTRAINT reconciliation_cash_counts_reconciliation_fk FOREIGN KEY (tenant_id, station_id, reconciliation_id)
    REFERENCES app.reconciliations (tenant_id, station_id, id),
  CONSTRAINT reconciliation_cash_counts_entered_by_fk FOREIGN KEY (tenant_id, entered_by)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT reconciliation_cash_counts_currency_ck CHECK (currency = 'USD'),
  CONSTRAINT reconciliation_cash_counts_counted_ck CHECK (counted_cash >= 0),
  CONSTRAINT reconciliation_cash_counts_handover_ck CHECK (handover_amount IS NULL OR handover_amount >= 0)
);

-- Historical proposal: detail rows are draft evidence and require state guards.
ALTER TABLE app.reconciliation_attendants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reconciliation_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reconciliation_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reconciliation_tank_dips ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reconciliation_cash_counts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'reconciliation_attendants', 'reconciliation_expenses',
    'reconciliation_deliveries', 'reconciliation_tank_dips',
    'reconciliation_cash_counts'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_context ON app.%I USING (tenant_id = app.current_tenant_id() AND app.has_active_membership()) WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership())', table_name);
  END LOOP;
END $$;
