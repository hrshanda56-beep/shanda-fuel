-- ADR-017: customer credit can be used at any permitted station.
-- A customer's credit is with exactly one legal entity. Each customer account
-- may use all stations of that legal entity (default) or a chosen subset.
-- Existing rows keep a null legal entity until onboarding confirms it; the
-- application refuses fuel authorisation for an account without one.
ALTER TABLE app.customers ADD COLUMN legal_entity_id uuid;
ALTER TABLE app.customers
  ADD CONSTRAINT customers_tenant_id_id_legal_entity_uidx UNIQUE (tenant_id, id, legal_entity_id);
ALTER TABLE app.customers
  ADD CONSTRAINT customers_legal_entity_fk
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES app.legal_entities (tenant_id, id);

ALTER TABLE app.customer_accounts ADD COLUMN legal_entity_id uuid;
ALTER TABLE app.customer_accounts ADD COLUMN station_scope text NOT NULL DEFAULT 'ALL';
ALTER TABLE app.customer_accounts
  ADD CONSTRAINT customer_accounts_station_scope_ck CHECK (station_scope IN ('ALL', 'SELECTED'));
ALTER TABLE app.customer_accounts
  ADD CONSTRAINT customer_accounts_tenant_id_id_legal_entity_uidx UNIQUE (tenant_id, id, legal_entity_id);
-- An account's legal entity must be its customer's legal entity (null skips the check).
ALTER TABLE app.customer_accounts
  ADD CONSTRAINT customer_accounts_customer_legal_entity_fk
  FOREIGN KEY (tenant_id, customer_id, legal_entity_id)
  REFERENCES app.customers (tenant_id, id, legal_entity_id);

CREATE TABLE app.customer_account_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  station_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_account_stations_account_station_uidx UNIQUE (tenant_id, account_id, station_id),
  -- The account must belong to the same legal entity as the station.
  CONSTRAINT customer_account_stations_account_fk
    FOREIGN KEY (tenant_id, account_id, legal_entity_id)
    REFERENCES app.customer_accounts (tenant_id, id, legal_entity_id),
  CONSTRAINT customer_account_stations_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations (tenant_id, legal_entity_id, id),
  CONSTRAINT customer_account_stations_created_by_fk
    FOREIGN KEY (tenant_id, created_by) REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT customer_account_stations_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by) REFERENCES app.memberships (tenant_id, id)
);
CREATE INDEX customer_account_stations_station_idx
  ON app.customer_account_stations (tenant_id, station_id) WHERE active;

ALTER TABLE app.customer_account_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.customer_account_stations FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_account_stations_tenant_context ON app.customer_account_stations
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.customer_account_stations OWNER TO migration_owner;
  END IF;
  -- No DELETE: removing a station deactivates the row so history is kept.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.customer_account_stations TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    GRANT SELECT ON app.customer_account_stations TO diagnostics_readonly;
  END IF;
END
$$;
