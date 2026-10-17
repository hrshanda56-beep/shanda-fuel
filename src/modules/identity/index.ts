export {
  assertSessionActive,
  assertStepUp,
  assertStrongAuthentication,
  invalidateExpiredAssurance,
} from '../../platform/security';
export type { SessionRecord } from '../../platform/security';
export {
  requireAuthenticatedActor,
  resolveAuthenticatedActor,
  revokeIdentitySessions,
} from './authenticated-actor';
export {
  establishStepUp,
  CLERK_STEP_UP_POLICY,
  ClerkReverificationRequiredError,
  STEP_UP_LEVEL,
  STEP_UP_TTL_MS,
  type StepUpResult,
} from './step-up';
export {
  CLERK_DEACTIVATE_STAFF_ACTION,
  CLERK_STEP_UP_ACTION,
} from '../../platform/auth/clerk-step-up';
export type { AuthenticatedActorContext, AuthenticatedActorResolver } from './authenticated-actor';
