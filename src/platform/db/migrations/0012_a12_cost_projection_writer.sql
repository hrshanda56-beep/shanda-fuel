CREATE OR REPLACE FUNCTION app.upsert_inventory_cost_stream_state(
  p_tenant_id uuid,
  p_station_id uuid,
  p_tank_id uuid,
  p_product_id uuid,
  p_quantity_litres numeric(18, 3),
  p_inventory_value numeric(20, 4),
  p_currency text,
  p_weighted_average_cost numeric(20, 8),
  p_valuation_status text,
  p_last_movement_effective_at timestamptz,
  p_last_movement_id uuid,
  p_last_cost_event_effective_at timestamptz,
  p_last_cost_event_id uuid,
  p_projection_version integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM app.current_tenant_id() THEN
    RAISE EXCEPTION 'inventory cost projection tenant context mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF NOT app.has_active_membership() THEN
    RAISE EXCEPTION 'inventory cost projection requires an active membership'
      USING ERRCODE = '42501';
  END IF;
  IF app.current_station_id() IS NOT NULL
     AND p_station_id IS DISTINCT FROM app.current_station_id() THEN
    RAISE EXCEPTION 'inventory cost projection station context mismatch'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO app.inventory_cost_stream_state (
    tenant_id,
    station_id,
    tank_id,
    product_id,
    quantity_litres,
    inventory_value,
    currency,
    weighted_average_cost,
    valuation_status,
    last_movement_effective_at,
    last_movement_id,
    last_cost_event_effective_at,
    last_cost_event_id,
    projection_version,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_station_id,
    p_tank_id,
    p_product_id,
    p_quantity_litres,
    p_inventory_value,
    p_currency,
    p_weighted_average_cost,
    p_valuation_status,
    p_last_movement_effective_at,
    p_last_movement_id,
    p_last_cost_event_effective_at,
    p_last_cost_event_id,
    p_projection_version,
    now()
  )
  ON CONFLICT (tenant_id, station_id, tank_id, product_id)
  DO UPDATE SET
    quantity_litres = EXCLUDED.quantity_litres,
    inventory_value = EXCLUDED.inventory_value,
    currency = EXCLUDED.currency,
    weighted_average_cost = EXCLUDED.weighted_average_cost,
    valuation_status = EXCLUDED.valuation_status,
    last_movement_effective_at = EXCLUDED.last_movement_effective_at,
    last_movement_id = EXCLUDED.last_movement_id,
    last_cost_event_effective_at = EXCLUDED.last_cost_event_effective_at,
    last_cost_event_id = EXCLUDED.last_cost_event_id,
    projection_version = EXCLUDED.projection_version,
    updated_at = now();
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    RAISE EXCEPTION 'migration_owner role is required for the A12.3 projection writer';
  END IF;
  ALTER FUNCTION app.upsert_inventory_cost_stream_state(
    uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, text,
    timestamptz, uuid, timestamptz, uuid, integer
  ) OWNER TO migration_owner;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.upsert_inventory_cost_stream_state(
  uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, text,
  timestamptz, uuid, timestamptz, uuid, integer
) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.upsert_inventory_cost_stream_state(
  uuid, uuid, uuid, uuid, numeric, numeric, text, numeric, text,
  timestamptz, uuid, timestamptz, uuid, integer
) TO app_runtime;
