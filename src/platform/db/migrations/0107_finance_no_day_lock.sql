-- Locking a business day is a permanent step, so only the owner and the administrator may do it.
-- The application's role matrix (permissions.ts) already dropped business_day.lock from FINANCE;
-- this removes the matching seeded grant (0003) so the database never grants more than the code
-- (the role-permissions parity test). OWNER and ADMINISTRATOR keep the permission. SUPERVISOR and
-- AREA_MANAGER never held it.
DELETE FROM platform.role_permissions
WHERE role_code = 'FINANCE'
  AND permission_code = 'business_day.lock';
