-- Three more roles (D2). They add no new permission code; each is a set of existing permissions.
--
-- AUDITOR: read only, on every screen the organisation has, and can do nothing. It holds every
--   permission whose code is a view permission, and none that acts (no export, no approval).
-- AREA_MANAGER: runs several stations. The supervisor's permissions, plus the finance reports.
--   Which stations come from the station assignments, exactly as for a supervisor.
-- CASH_COLLECTOR: collects cash from stations and hands it on. Receives collections and accepts
--   or submits handovers, and sees deposits; nothing else.
--
-- Each is written once, in plain statements, so it can be read and checked against
-- src/platform/security/permissions.ts (the same sets, tested for equality).
INSERT INTO platform.role_definitions (code, description)
VALUES
  ('AUDITOR', 'Read-only access to every screen, with no actions'),
  ('AREA_MANAGER', 'Runs several selected stations: the supervisor permissions plus finance reports'),
  ('CASH_COLLECTOR', 'Collects cash from stations and hands it on')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT 'AUDITOR', code
FROM platform.permission_definitions
WHERE code = 'tenant.context.select' OR code ~ '\.view(\.|$)'
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
SELECT 'AREA_MANAGER', permission_code
FROM platform.role_permissions
WHERE role_code = 'SUPERVISOR'
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
-- The supervisor's database grants lack four permissions that are defined and that the code gives a
-- supervisor (the application authorises from the code), so the area manager states them outright.
-- One code (provider.batch.record) exists only in the code and is not in
-- platform.permission_definitions, so it cannot be granted here at all.
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('AREA_MANAGER', 'report.finance.view'),
  ('AREA_MANAGER', 'cash.collection.record'),
  ('AREA_MANAGER', 'cash.collection.view'),
  ('AREA_MANAGER', 'cash.count.record'),
  ('AREA_MANAGER', 'cash.handover.submit')
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('CASH_COLLECTOR', 'tenant.context.select'),
  ('CASH_COLLECTOR', 'station.view'),
  ('CASH_COLLECTOR', 'cash.collection.view'),
  ('CASH_COLLECTOR', 'cash.collection.receive'),
  ('CASH_COLLECTOR', 'cash.handover.submit'),
  ('CASH_COLLECTOR', 'cash.handover.accept'),
  ('CASH_COLLECTOR', 'cash.deposit.view')
ON CONFLICT (role_code, permission_code) DO NOTHING;
