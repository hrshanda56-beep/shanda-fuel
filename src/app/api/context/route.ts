import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  clearPersistedContext,
  writePersistedContext,
  type ContextCookieWriter,
} from '@/modules/context/server';
import { resolveCurrentContext, validateRequestedContext } from '@/modules/context/server';
import type { ContextSelection } from '@/modules/context';
import { readContextRoute } from '@/modules/context';
import { apiErrorResponse, withRequestObservability } from '@/platform/observability';

export const runtime = 'nodejs';

const selectionSchema = z
  .object({
    organisationId: z.string().uuid(),
    legalEntityId: z.string().uuid().optional(),
    stationId: z.string().uuid().optional(),
    allStations: z.boolean(),
  })
  .superRefine((selection, refinement) => {
    if (selection.allStations && selection.stationId) {
      refinement.addIssue({
        code: 'custom',
        path: ['stationId'],
        message: 'An all-stations selection cannot contain a station',
      });
    }
  });

const postSchema = z.object({
  pathname: z.string().min(1).max(2048),
  selection: selectionSchema,
});

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const pathname = url.searchParams.get('pathname');
    const resolution = await resolveCurrentContext(request, {
      route: readContextRoute(
        pathname && pathname.startsWith('/') ? pathname : '/',
        url.searchParams,
      ),
    });
    const response = json({ data: resolution });
    if (resolution.persistedContextInvalid) {
      clearPersistedContext(response as unknown as ContextCookieWriter);
    }
    return response;
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: false,
      headers: { 'cache-control': 'no-store' },
    });
  }
});

export const POST = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const input = postSchema.parse(await request.json());
    const selection = await validateRequestedContext(request, input.selection as ContextSelection, {
      pathname: input.pathname,
    });
    const response = json({ data: { current: selection } });
    writePersistedContext(response as unknown as ContextCookieWriter, selection);
    return response;
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: false,
      headers: { 'cache-control': 'no-store' },
    });
  }
});
