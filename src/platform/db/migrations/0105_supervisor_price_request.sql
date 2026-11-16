-- A station supervisor may start a selling price change for their own station. Approving, preparing
-- the readings and activating are unchanged: an owner or administrator still approves (DEC-049),
-- so the person who asks for a price is never the only one who decides it.
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('SUPERVISOR', 'price.change.request')
ON CONFLICT (role_code, permission_code) DO NOTHING;
