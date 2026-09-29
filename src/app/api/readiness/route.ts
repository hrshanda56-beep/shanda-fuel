import { NextResponse } from 'next/server';
import { checkDatabase } from '@/platform/db/client';
import { getServerEnv } from '@/platform/config/env';
import {
  getRequestId,
  observeDependencyFailure,
  withRequestObservability,
} from '@/platform/observability';

export const runtime = 'nodejs';

export const GET = withRequestObservability(async (request: Request) => {
  const requestId = getRequestId(request);
  const env = getServerEnv();
  const database = env.DATABASE_URL ? await checkDatabase() : { status: 'not_configured' as const };
  const ready = database.status === 'ok';
  if (!ready) observeDependencyFailure(request, 'postgresql');

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'not_ready',
      service: 'shanda-fuel',
      checks: { database },
      timestamp: new Date().toISOString(),
      requestId,
    },
    {
      status: ready ? 200 : 503,
      headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
    },
  );
});
