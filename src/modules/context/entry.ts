import 'server-only';

import { AppError } from '../../platform/errors';
import {
  resolveAuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../identity/authenticated-actor';
import { resolveCurrentContext, type QueryDependencies } from './queries';
import type { ContextResolution } from './contracts';

export type RootEntryState =
  | { status: 'unauthenticated' }
  | { status: 'ready'; resolution: ContextResolution }
  | { status: 'choose-context'; resolution: ContextResolution }
  | { status: 'no-authorised-context' }
  | { status: 'unavailable' };

export function classifyRootEntryState(resolution: ContextResolution): RootEntryState {
  if (resolution.available.organisations.length === 0) {
    return { status: 'no-authorised-context' };
  }
  if (!resolution.current) {
    return { status: 'choose-context', resolution };
  }
  return { status: 'ready', resolution };
}

type RootEntryDependencies = QueryDependencies & {
  resolveActor?: AuthenticatedActorResolver;
};

/**
 * Resolve the root entry state before Today or the application shell is
 * rendered. The actor is resolved once and reused for context discovery; no
 * client-provided identity, tenant, or scope is trusted here.
 */
export async function resolveRootEntryState(
  request: Request,
  dependencies: RootEntryDependencies = {},
): Promise<RootEntryState> {
  const now = dependencies.now ?? new Date();
  let actor;

  try {
    actor = dependencies.resolveActor
      ? await dependencies.resolveActor(request)
      : await resolveAuthenticatedActor(request, undefined, now);
  } catch (error) {
    if (isUnauthenticated(error)) return { status: 'unauthenticated' };
    return { status: 'unavailable' };
  }

  if (!actor) return { status: 'unauthenticated' };

  try {
    const resolution = await resolveCurrentContext(request, {
      dependencies: {
        ...dependencies,
        resolveActor: async () => actor,
      },
    });
    return classifyRootEntryState(resolution);
  } catch (error) {
    if (isUnauthenticated(error)) return { status: 'unauthenticated' };
    return { status: 'unavailable' };
  }
}

function isUnauthenticated(error: unknown): boolean {
  return error instanceof AppError && error.code === 'UNAUTHENTICATED';
}
