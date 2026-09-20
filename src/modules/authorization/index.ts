export {
  authorize,
  assertRoleMutationAllowed,
  DEFAULT_ROLE_PERMISSIONS,
  isAuthorized,
  PERMISSION_CODES,
  ROLE_CODES,
  scopeCovers,
} from '@/platform/security';
export type {
  AccessScope,
  AuthorizationActor,
  PermissionCode,
  RoleAssignment,
  RoleCode,
  ScopeType,
  TemporaryPermissionGrant,
  RoleMutation,
} from '@/platform/security';
