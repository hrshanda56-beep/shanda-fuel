-- Recurring fixed costs can belong to one station or the whole legal entity.
-- A NULL station_id is the company/legal-entity scope. Existing station-scoped rows
-- retain their exact station attribution and all recognition facts remain append-only.

ALTER TABLE app.recurring_cost_templates
  DROP CONSTRAINT recurring_cost_templates_tenant_station_name_uidx,
  DROP CONSTRAINT recurring_cost_templates_station_fk,
  ALTER COLUMN station_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.recurring_cost_templates
  ADD CONSTRAINT recurring_cost_templates_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations(tenant_id, legal_entity_id, id),
  ADD CONSTRAINT recurring_cost_templates_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities(tenant_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX recurring_cost_templates_tenant_station_name_uidx
  ON app.recurring_cost_templates (tenant_id, station_id, name)
  WHERE station_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX recurring_cost_templates_tenant_legal_entity_name_uidx
  ON app.recurring_cost_templates (tenant_id, legal_entity_id, name)
  WHERE station_id IS NULL;
--> statement-breakpoint

ALTER TABLE app.recurring_cost_periods
  DROP CONSTRAINT recurring_cost_periods_station_fk,
  ALTER COLUMN station_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.recurring_cost_periods
  ADD CONSTRAINT recurring_cost_periods_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations(tenant_id, legal_entity_id, id),
  ADD CONSTRAINT recurring_cost_periods_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities(tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.recurring_cost_recognitions
  DROP CONSTRAINT recurring_cost_recognitions_station_fk,
  ALTER COLUMN station_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.recurring_cost_recognitions
  ADD CONSTRAINT recurring_cost_recognitions_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations(tenant_id, legal_entity_id, id),
  ADD CONSTRAINT recurring_cost_recognitions_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities(tenant_id, id);
--> statement-breakpoint

ALTER TABLE app.expense_recognition_movements
  DROP CONSTRAINT expense_recognition_movements_station_fk,
  ALTER COLUMN station_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app.expense_recognition_movements
  ADD CONSTRAINT expense_recognition_movements_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations(tenant_id, legal_entity_id, id),
  ADD CONSTRAINT expense_recognition_movements_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities(tenant_id, id);
--> statement-breakpoint

-- Cross-tenant work discovery is deliberately limited to active recurring templates and an
-- active membership that already has expense.recurring.recognize through the normal role model.
-- Actual writes happen in a tenant-context transaction in application code.
CREATE FUNCTION app.recurring_cost_job_work(p_limit integer)
RETURNS TABLE (
  tenant_id uuid,
  legal_entity_id uuid,
  station_id uuid,
  template_id uuid,
  period_start text,
  recognition_date text,
  membership_id uuid,
  identity_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform, pg_temp
AS $$
  WITH candidates AS (
    SELECT
      t.tenant_id,
      t.legal_entity_id,
      t.station_id,
      t.id AS template_id,
      to_char(
        CASE
          WHEN t.station_id IS NULL THEN current_date
          ELSE current_timestamp AT TIME ZONE s.timezone
        END,
        'YYYY-MM-DD'
      ) AS recognition_date,
      actor.membership_id,
      actor.identity_id
    FROM app.recurring_cost_templates t
    LEFT JOIN app.stations s
      ON s.tenant_id = t.tenant_id AND s.id = t.station_id
    JOIN LATERAL (
      SELECT m.id AS membership_id, m.identity_id
      FROM app.memberships m
      JOIN app.membership_role_assignments a
        ON a.tenant_id = m.tenant_id AND a.membership_id = m.id
       AND (a.expires_at IS NULL OR a.expires_at > now())
      JOIN platform.role_permissions rp
        ON rp.role_code = a.role_code
       AND rp.permission_code = 'expense.recurring.recognize'
      WHERE m.tenant_id = t.tenant_id
        AND m.status = 'ACTIVE'
        AND (
          a.scope_type = 'TENANT'
          OR (a.scope_type = 'LEGAL_ENTITY' AND a.legal_entity_id = t.legal_entity_id)
          OR (a.scope_type = 'STATION' AND t.station_id IS NOT NULL AND a.station_id = t.station_id)
        )
      ORDER BY CASE a.role_code WHEN 'OWNER' THEN 1 WHEN 'ADMINISTRATOR' THEN 2 WHEN 'FINANCE' THEN 3 ELSE 4 END,
               m.id
      LIMIT 1
    ) actor ON true
    WHERE t.status = 'ACTIVE'
      AND t.start_date <= to_char(
        CASE
          WHEN t.station_id IS NULL THEN current_date
          ELSE current_timestamp AT TIME ZONE s.timezone
        END,
        'YYYY-MM-DD'
      )
      AND (t.end_date IS NULL OR t.end_date >= to_char(
        CASE
          WHEN t.station_id IS NULL THEN current_date
          ELSE current_timestamp AT TIME ZONE s.timezone
        END,
        'YYYY-MM-DD'
      ))
  )
  SELECT
    c.tenant_id,
    c.legal_entity_id,
    c.station_id,
    c.template_id,
    left(c.recognition_date, 7) || '-01',
    c.recognition_date,
    c.membership_id,
    c.identity_id
  FROM candidates c
  ORDER BY c.tenant_id, c.legal_entity_id, c.station_id NULLS FIRST, c.template_id
  LIMIT greatest(least(coalesce(p_limit, 0), 1000), 0)
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.recurring_cost_job_work(integer) OWNER TO migration_owner;
  END IF;
  REVOKE ALL ON FUNCTION app.recurring_cost_job_work(integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.recurring_cost_job_work(integer) TO app_runtime;
  END IF;
END
$$;
