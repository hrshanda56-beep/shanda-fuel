-- Phase 1 customer management alignment.
-- Customer master-data and account-policy mutations are management capabilities;
-- FINANCE retains explicitly granted operational customer permissions only.
DELETE FROM platform.role_permissions
WHERE role_code = 'FINANCE'
  AND permission_code IN (
    'customer.manage',
    'customer.account.manage',
    'customer.account.adjust',
    'customer.limit.override'
  );
