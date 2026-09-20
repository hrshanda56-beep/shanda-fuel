import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { checkDatabase } from '@/platform/db/client';
import { getServerEnv } from '@/platform/config/env';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  const env = getServerEnv();
  const database = env.DATABASE_URL ? await checkDatabase() : { status: 'not_configured' as const };
  const ready = database.status === 'ok';

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
}
