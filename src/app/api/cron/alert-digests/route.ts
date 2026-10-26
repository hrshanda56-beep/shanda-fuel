import { NextResponse } from 'next/server';
import { getServerEnv } from '../../../../platform/config/env';
import { runAlertEmailDigests } from '../../../../modules/alerts/email-delivery';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { authorizeCronRequest } from '../../../../platform/security/cron';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Vercel Cron entry point for the bounded, opt-in alert email digest. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const env = getServerEnv();
    authorizeCronRequest(request, env.CRON_SECRET);
    const result = await runAlertEmailDigests({ env });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { headers: { 'Cache-Control': 'no-store' } });
  }
});
