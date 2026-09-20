import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();

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
}
