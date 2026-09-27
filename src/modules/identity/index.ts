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
  STEP_UP_LEVEL,
  STEP_UP_TTL_MS,
  type StepUpDependencies,
  type StepUpResult,
} from './step-up';
export type {
  AuthenticatedActorContext,
  AuthenticatedActorResolver,
  BetterAuthServer,
  BetterAuthPasswordVerifier,
  BetterAuthSessionReader,
  BetterAuthSessionRevoker,
} from './authenticated-actor';
