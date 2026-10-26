-- Approved transporters and other creditor liabilities are a small append-only
-- ledger. Corrections and reversals are new rows; the original fact is never
-- overwritten or deleted.
CREATE TABLE app.approved_liability_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  station_id uuid,
  liability_account_id uuid NOT NULL,
  original_entry_id uuid,
  liability_kind text NOT NULL,
  entry_type text NOT NULL,
  direction text NOT NULL,
  counterparty_name text NOT NULL,
  reference text NOT NULL,
  amount numeric(20, 4) NOT NULL,
  currency text DEFAULT 'USD' NOT NULL,
  effective_date text NOT NULL,
  due_date text,
  reason text,
  actor_membership_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT approved_liability_entries_tenant_id_uidx UNIQUE (tenant_id, id),
  CONSTRAINT approved_liability_entries_source_uidx UNIQUE (tenant_id, liability_account_id, reference, entry_type),
  CONSTRAINT approved_liability_entries_kind_ck CHECK (liability_kind in ('TRANSPORTER','OTHER')),
  CONSTRAINT approved_liability_entries_type_ck CHECK (entry_type in ('RECOGNITION','ADJUSTMENT','REVERSAL')),
  CONSTRAINT approved_liability_entries_direction_ck CHECK (direction in ('INCREASE','DECREASE')),
  CONSTRAINT approved_liability_entries_amount_ck CHECK (amount > 0),
  CONSTRAINT approved_liability_entries_currency_ck CHECK (currency = 'USD'),
  CONSTRAINT approved_liability_entries_adjustment_ck CHECK (
    (entry_type = 'RECOGNITION' and original_entry_id is null and direction = 'INCREASE')
    or (entry_type in ('ADJUSTMENT','REVERSAL') and original_entry_id is not null)
  )
);
--> statement-breakpoint
ALTER TABLE app.approved_liability_entries
  ADD CONSTRAINT approved_liability_entries_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES app.tenants(id),
  ADD CONSTRAINT approved_liability_entries_legal_entity_fk
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES app.legal_entities(tenant_id, id),
  ADD CONSTRAINT approved_liability_entries_station_fk
  FOREIGN KEY (tenant_id, station_id) REFERENCES app.stations(tenant_id, id),
  ADD CONSTRAINT approved_liability_entries_original_entry_fk
  FOREIGN KEY (tenant_id, original_entry_id) REFERENCES app.approved_liability_entries(tenant_id, id),
  ADD CONSTRAINT approved_liability_entries_actor_fk
  FOREIGN KEY (tenant_id, actor_membership_id) REFERENCES app.memberships(tenant_id, id);
--> statement-breakpoint
CREATE INDEX approved_liability_entries_scope_date_idx
  ON app.approved_liability_entries (tenant_id, legal_entity_id, station_id, effective_date);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.approved_liability_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.station_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.stations s
    WHERE s.tenant_id = NEW.tenant_id
      AND s.id = NEW.station_id
      AND s.legal_entity_id = NEW.legal_entity_id
  ) THEN
    RAISE EXCEPTION 'liability station is outside the selected legal entity';
  END IF;
  IF NEW.entry_type in ('ADJUSTMENT','REVERSAL') AND NOT EXISTS (
    SELECT 1 FROM app.approved_liability_entries original
    WHERE original.tenant_id = NEW.tenant_id
      AND original.id = NEW.original_entry_id
      AND original.liability_account_id = NEW.liability_account_id
      AND original.legal_entity_id = NEW.legal_entity_id
      AND original.liability_kind = NEW.liability_kind
      AND original.counterparty_name = NEW.counterparty_name
  ) THEN
    RAISE EXCEPTION 'liability adjustment must reference the same liability account';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approved_liability_scope_guard
BEFORE INSERT ON app.approved_liability_entries
FOR EACH ROW EXECUTE FUNCTION app.approved_liability_scope_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.approved_liability_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'approved liabilities are append-only; use a named adjustment or reversal';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approved_liability_append_only
BEFORE UPDATE OR DELETE ON app.approved_liability_entries
FOR EACH ROW EXECUTE FUNCTION app.approved_liability_append_only();
--> statement-breakpoint
ALTER TABLE app.approved_liability_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.approved_liability_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY approved_liability_entries_tenant_context ON app.approved_liability_entries
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
INSERT INTO platform.permission_definitions (code, description)
VALUES ('finance.liability.manage', 'Record and adjust approved non-supplier liabilities')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'finance.liability.manage'),
  ('ADMINISTRATOR', 'finance.liability.manage'),
  ('FINANCE', 'finance.liability.manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.approved_liability_entries OWNER TO migration_owner;
    ALTER FUNCTION app.approved_liability_scope_guard() OWNER TO migration_owner;
    ALTER FUNCTION app.approved_liability_append_only() OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT ON app.approved_liability_entries TO app_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.approved_liability_entries FROM app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.approved_liability_entries TO diagnostics_readonly;
  END IF;
END
$$;
