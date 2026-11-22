'use client';

import { useReverification } from '@clerk/nextjs';

/** The "confirm it's you" check the day lock needs. One check covers every lock that follows. */
export function useLockVerification() {
  const clerkAwareStepUp = useReverification(
    async (input: { tenantId: string; action: 'LOCK_BUSINESS_DAY' }) => {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as {
        message?: string;
        clerk_error?: unknown;
        status?: string;
      };
      if (!response.ok) {
        if (body.clerk_error) return body;
        throw new Error(body.message ?? 'Step-up verification failed.');
      }
      return body;
    },
  );

  return async (tenantId: string) => {
    const result = await clerkAwareStepUp({ tenantId, action: 'LOCK_BUSINESS_DAY' });
    if (result?.status !== 'active') {
      throw new Error('Identity verification was not completed. No change was posted.');
    }
  };
}

export type LockOutcome = { id: string; locked: boolean; message?: string };

/**
 * Locks closed days one after another, each with the normal lock command, so every server check
 * still applies. A day that cannot be locked is reported and the rest carry on.
 */
export async function lockClosedDays(
  scope: { tenantId: string; stationId: string },
  days: readonly { id: string; version: number }[],
): Promise<LockOutcome[]> {
  const outcomes: LockOutcome[] = [];
  for (const day of days) {
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `lock-late-${day.id}-${day.version}`,
        },
        body: JSON.stringify({
          commandType: 'LockBusinessDay',
          tenantId: scope.tenantId,
          stationId: scope.stationId,
          businessDayId: day.id,
          expectedVersion: day.version,
        }),
      });
      if (response.ok) {
        outcomes.push({ id: day.id, locked: true });
      } else {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        outcomes.push({ id: day.id, locked: false, message: body.message });
      }
    } catch {
      outcomes.push({ id: day.id, locked: false, message: 'The connection failed.' });
    }
  }
  return outcomes;
}
