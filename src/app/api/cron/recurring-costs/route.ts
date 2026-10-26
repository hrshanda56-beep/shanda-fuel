import { NextResponse } from 'next/server';
import { getServerEnv } from '../../../../platform/config/env';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { authorizeCronRequest } from '../../../../platform/security/cron';
import { runAutomaticRecurringCostRecognition } from '../../../../modules/expenses/recurring-cost-scheduler';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Vercel Cron entry point for daily, idempotent recurring-cost recognition. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const env = getServerEnv();
    authorizeCronRequest(request, env.CRON_SECRET);
    const result = await runAutomaticRecurringCostRecognition();
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error, { headers: { 'Cache-Control': 'no-store' } });
  }
});
