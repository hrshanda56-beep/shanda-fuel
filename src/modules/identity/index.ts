export {
  assertSessionActive,
  assertStepUp,
  assertStrongAuthentication,
} from '../../platform/security';
export type { SessionRecord } from '../../platform/security';
export {
  requireAuthenticatedActor,
  resolveAuthenticatedActor,
  revokeIdentitySessions,
} from './authenticated-actor';
export type {
  AuthenticatedActorContext,
  AuthenticatedActorResolver,
  BetterAuthServer,
  BetterAuthSessionReader,
  BetterAuthSessionRevoker,
} from './authenticated-actor';
