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
export {
  assertSessionActive,
  assertStepUp,
  assertStrongAuthentication,
  invalidateExpiredAssurance,
} from './session';
export type { SessionRecord } from './session';
export { serializeSafe } from './safe-serialization';
export type { SerializationPolicy } from './safe-serialization';
export { signSecurityEvent, verifySecurityEvent } from './audit-signing';
export type { SignedSecurityEvent } from './audit-signing';
export {
  AUTH_RATE_LIMIT,
  WRITE_RATE_LIMIT,
  consumePersistentRateLimit,
  getRateLimitClientAddress,
  hashRateLimitKey,
  rateLimitResponse,
  withPersistentRateLimit,
} from './rate-limit';
export type { RateLimitDecision, RateLimitPolicy } from './rate-limit';
