import { NextResponse } from 'next/server';
import { getServerEnv } from '../../../../platform/config/env';
import { AppError } from '../../../../platform/errors';
import { createLogger } from '../../../../platform/logging';
import { createResendEmailSender } from '../../../../platform/email';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import {
  createDigestPorts,
  DIGEST_RECIPIENT_CAP,
  listDigestRecipients,
} from '../../../../modules/alerts/persistence';
import { runDigests } from '../../../../modules/alerts/run-digests';
import { authorizeDigestJob } from '../../../../modules/identity/digest-actor';

export const runtime = 'nodejs';
export const maxDuration = 300;

const logger = createLogger({ component: 'alerts.digest' });

/**
 * ADR-020: the daily alert email. Vercel calls this once a morning with
 * `Authorization: Bearer <CRON_SECRET>`. It does nothing for an organisation whose alert email is
 * switched off (the recipient list is empty for it), does nothing when email is not configured,
 * and never writes anything except the record of what it sent. Logs counts only: no addresses, no
 * alert text.
 */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const env = getServerEnv();
    const ticket = authorizeDigestJob(request, env.CRON_SECRET);
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Email delivery is not configured');
    }

    const recipients = await listDigestRecipients(DIGEST_RECIPIENT_CAP);
    const result = await runDigests(
      recipients,
      createDigestPorts({
        ticket,
        appUrl: env.APP_URL,
        sender: createResendEmailSender(env),
        onFailure: (_recipient, stage) => {
          logger.error('Alert digest failed for one person', {
            signal: 'digest_failure',
            stage,
          });
        },
      }),
    );
    logger.info('Alert digest run finished', { signal: 'digest_run', ...result });
    return NextResponse.json(
      { ...result, capped: recipients.length >= DIGEST_RECIPIENT_CAP },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { headers: { 'Cache-Control': 'no-store' } });
  }
});
