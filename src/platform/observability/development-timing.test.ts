import { afterEach, describe, expect, it } from 'vitest';
import {
  installDevelopmentTimingSinkForTests,
  withDevelopmentTiming,
  type DevelopmentTimingSpan,
} from './development-timing';

describe('development timing', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('reports only a fixed stage and duration to an installed test sink', async () => {
    const spans: DevelopmentTimingSpan[] = [];
    restore = installDevelopmentTimingSinkForTests((span) => spans.push(span));

    await withDevelopmentTiming('auth.session.resolve.better_auth', async () => undefined);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ stage: 'auth.session.resolve.better_auth' });
    expect(spans[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(spans[0] ?? {}).sort()).toEqual(['durationMs', 'stage']);
  });

  it('does not change the result or swallow failures', async () => {
    const restoreSink = installDevelopmentTimingSinkForTests(() => undefined);
    restore = restoreSink;

    await expect(withDevelopmentTiming('db.tenant_transaction', () => 'ok')).resolves.toBe('ok');
    await expect(
      withDevelopmentTiming('db.tenant_transaction', async () => {
        throw new Error('fixture failure');
      }),
    ).rejects.toThrow('fixture failure');
  });
});
