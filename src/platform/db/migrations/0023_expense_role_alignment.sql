-- Expense authorization is intentionally limited to station supervisors for
-- preparation and owners for the full management lifecycle.  This corrective
-- migration also removes the broader grants from the original expense slice
-- for databases where 0021 has already been applied.
ALTER TABLE app.expense_recognition_events DROP CONSTRAINT IF EXISTS expense_recognition_events_station_fk;
--> statement-breakpoint
ALTER TABLE app.expense_recognition_events
  ADD CONSTRAINT expense_recognition_events_station_fk
  FOREIGN KEY (tenant_id, legal_entity_id, station_id)
  REFERENCES app.stations (tenant_id, legal_entity_id, id);
--> statement-breakpoint
DELETE FROM platform.role_permissions
WHERE permission_code IN ('expense.view', 'expense.submit', 'expense.approve', 'expense.post', 'expense.reverse')
  AND role_code IN ('ADMINISTRATOR', 'FINANCE', 'ATTENDANT');
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT role_code, permission_code FROM (VALUES
  ('OWNER','expense.view'),('OWNER','expense.submit'),('OWNER','expense.approve'),('OWNER','expense.post'),('OWNER','expense.reverse'),
  ('SUPERVISOR','expense.view'),('SUPERVISOR','expense.submit')
) AS permissions(role_code, permission_code)
ON CONFLICT DO NOTHING;
