import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors';
import { authorizeDigestJob, digestActorOverride, runAsDigestRecipient } from './digest-actor';
import { resolveAuthenticatedActor } from './authenticated-actor';

const SECRET = 'a-long-random-cron-secret-0123456789';
const bearer = (value: string) => new Request('http://x/y', { headers: { authorization: value } });

describe('digest job authorisation', () => {
  it('accepts only the exact bearer secret', () => {
    expect(() => authorizeDigestJob(bearer(`Bearer ${SECRET}`), SECRET)).not.toThrow();
    for (const header of [
      '',
      SECRET,
      `bearer ${SECRET}`,
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      'Bearer ',
    ]) {
      expect(() => authorizeDigestJob(bearer(header), SECRET)).toThrow(AppError);
    }
    expect(() => authorizeDigestJob(new Request('http://x/y'), SECRET)).toThrow(AppError);
  });

  it('is off when no secret is configured, even for an empty bearer', () => {
    expect(() => authorizeDigestJob(bearer('Bearer '), undefined)).toThrow(AppError);
    expect(() => authorizeDigestJob(bearer('Bearer '), '')).toThrow(AppError);
  });
});

describe('acting as a recipient', () => {
  const identity = '11111111-1111-4111-8111-111111111111';

  it('needs a ticket that this module issued', () => {
    expect(() => runAsDigestRecipient({} as never, identity, async () => 1)).toThrow(AppError);
    expect(() => runAsDigestRecipient(undefined as never, identity, async () => 1)).toThrow(
      AppError,
    );
  });

  it('is visible only inside the run, with a short session and no strong authentication', async () => {
    const ticket = authorizeDigestJob(bearer(`Bearer ${SECRET}`), SECRET);
    const now = new Date('2026-10-24T05:00:00Z');
    const seen = await runAsDigestRecipient(
      ticket,
      identity,
      async () => {
        await Promise.resolve();
        return {
          override: digestActorOverride(),
          resolved: await resolveAuthenticatedActor(new Request('http://x/y')),
        };
      },
      now,
    );
    expect(seen.resolved).toBe(seen.override);
    expect(seen.override?.identityId).toBe(identity);
    expect(seen.override?.session.sessionId).toMatch(/^digest-job:/);
    expect(seen.override?.session.expiresAt.getTime()).toBe(now.getTime() + 10 * 60_000);
    expect(seen.override?.session.strongAuthenticatedAt).toBeUndefined();
    expect(seen.override?.session.stepUpLevel).toBeUndefined();
    expect(digestActorOverride()).toBeUndefined();
  });
});
