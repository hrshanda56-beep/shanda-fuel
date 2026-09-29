import { NextResponse } from 'next/server';
import { getRequestId, withRequestObservability } from '@/platform/observability';

export const runtime = 'nodejs';

export const GET = withRequestObservability((request: Request) => {
  const requestId = getRequestId(request);

  return NextResponse.json(
    {
      status: 'ok',
      service: 'shanda-fuel',
      checks: { application: 'ok' },
      timestamp: new Date().toISOString(),
      requestId,
    },
    { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
  );
});
