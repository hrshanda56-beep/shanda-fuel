export {
  authorize,
  assertRoleMutationAllowed,
  assertValidScope,
  DEFAULT_ROLE_PERMISSIONS,
  isAuthorized,
  PERMISSION_CODES,
  ROLE_CODES,
  scopeCovers,
} from './permissions';
export type {
  AccessScope,
  AuthorizationActor,
  PermissionCode,
  RoleAssignment,
  RoleCode,
  ScopeType,
  TemporaryPermissionGrant,
  RoleMutation,
} from './permissions';
export { assertSessionActive, assertStepUp, assertStrongAuthentication } from './session';
export type { SessionRecord } from './session';
export { serializeSafe } from './safe-serialization';
export type { SerializationPolicy } from './safe-serialization';
export { signSecurityEvent, verifySecurityEvent } from './audit-signing';
export type { SignedSecurityEvent } from './audit-signing';
