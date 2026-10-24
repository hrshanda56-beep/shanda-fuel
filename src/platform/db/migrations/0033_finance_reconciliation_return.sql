-- Finance reviews and approves daily reconciliations, so it must also be able to send one back for
-- correction instead of being forced to approve or leave it waiting. Mirrors
-- DEFAULT_ROLE_PERMISSIONS in src/platform/security/permissions.ts.
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES ('FINANCE', 'reconciliation.return')
ON CONFLICT DO NOTHING;
