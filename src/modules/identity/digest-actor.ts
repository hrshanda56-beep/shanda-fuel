import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../platform/errors';
import type { AuthenticatedActorContext } from './authenticated-actor';

/**
 * ADR-020: the one place where server code acts for a person who did not sign in. The scheduled
 * alert email reads each recipient's alerts with that person's own permissions, so it needs the
 * normal request loaders to see that person as the actor. This is deliberately narrow:
 *
 * - it exists only inside `runAsDigestRecipient`, which needs a ticket;
 * - a ticket exists only after the caller proved it holds `CRON_SECRET` (constant-time compare);
 * - the actor has no step-up or strong authentication, so nothing that needs those can run;
 * - its session lasts minutes and its id says it is a digest run.
 *
 * Authority still comes from the database (memberships and role assignments of that identity), so
 * the job can never see more than the person could.
 */

declare const digestJobTicketBrand: unique symbol;
export type DigestJobTicket = { readonly [digestJobTicketBrand]: 'authorised' };

const SESSION_MINUTES = 10;
const store = new AsyncLocalStorage<AuthenticatedActorContext>();
const issued = new WeakSet<object>();

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual needs equal lengths; a length mismatch still does a comparison of equal work.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Accepts only `Authorization: Bearer <CRON_SECRET>`. */
export function authorizeDigestJob(
  request: Request,
  configuredSecret: string | undefined,
): DigestJobTicket {
  if (!configuredSecret) throw new AppError('DEPENDENCY_UNAVAILABLE', 'Scheduled jobs are off');
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!constantTimeEqual(presented, configuredSecret)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
  const ticket = Object.freeze({}) as DigestJobTicket;
  issued.add(ticket);
  return ticket;
}

/** Run `work` so that the request loaders resolve `identityId` as the signed-in actor. */
export function runAsDigestRecipient<T>(
  ticket: DigestJobTicket,
  identityId: string,
  work: () => Promise<T>,
  now = new Date(),
): Promise<T> {
  if (!ticket || typeof ticket !== 'object' || !issued.has(ticket)) {
    throw new AppError('FORBIDDEN', 'A digest job ticket is required');
  }
  const actor: AuthenticatedActorContext = {
    identityId,
    session: {
      sessionId: `digest-job:${randomUUID()}`,
      userId: identityId,
      expiresAt: new Date(now.getTime() + SESSION_MINUTES * 60_000),
    },
  };
  return store.run(actor, work);
}

/** Read by `resolveAuthenticatedActor`; undefined everywhere except inside a digest run. */
export function digestActorOverride(): AuthenticatedActorContext | undefined {
  return store.getStore();
}
