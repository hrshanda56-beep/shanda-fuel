-- A station supervisor may start a selling price change for their own station. Approving, preparing
-- the readings and activating are unchanged: an owner or administrator still approves (DEC-049),
-- so the person who asks for a price is never the only one who decides it.
-- The area manager is defined as the supervisor's permissions plus the finance reports (D2), so it
-- receives the same permission over the stations it is assigned.
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('SUPERVISOR', 'price.change.request'), ('AREA_MANAGER', 'price.change.request')
ON CONFLICT (role_code, permission_code) DO NOTHING;
