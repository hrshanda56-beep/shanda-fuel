import { describe, expect, it } from 'vitest';
import { getServerEnv } from '../../platform/config/env';
import { runAlertEmailDigests } from './email-delivery';

describe('alert email delivery', () => {
  it('fails closed before loading recipients when Resend is not configured', async () => {
    await expect(
      runAlertEmailDigests({
        env: getServerEnv({ APP_ENV: 'test' }),
        recipients: [],
      }),
    ).rejects.toMatchObject({ name: 'EmailError', code: 'configuration' });
  });
});
