import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contextRoutePolicy, readContextRoute } from '../../../../modules/context';
import { resolveCurrentContext } from '../../../../modules/context/server';
import { getCashStationSummaryFromRequest } from '../../../../modules/cash/queries';
import { AppError } from '../../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z
  .object({
    organisationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
    legalEntityId: z.string().uuid().optional(),
    stationId: z.string().uuid(),
    allStations: z.enum(['true', '1', 'false', '0']).optional(),
  })
  .superRefine((value, refinement) => {
    if (!value.organisationId && !value.tenantId) {
      refinement.addIssue({
        code: 'custom',
        path: ['organisationId'],
        message: 'An organisation context is required',
      });
    }
    if (value.allStations === 'true' || value.allStations === '1') {
      refinement.addIssue({
        code: 'custom',
        path: ['allStations'],
        message: 'Cash summaries cannot use an all-stations context',
      });
    }
  });

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      organisationId: url.searchParams.get('organisationId') ?? undefined,
      tenantId: url.searchParams.get('tenantId') ?? undefined,
      legalEntityId: url.searchParams.get('legalEntityId') ?? undefined,
      stationId: url.searchParams.get('stationId'),
      allStations: url.searchParams.get('allStations') ?? undefined,
    });
    const pathname = `/stations/${encodeURIComponent(input.stationId)}/cash`;
    const policy = contextRoutePolicy(pathname);
    const resolution = await resolveCurrentContext(request, {
      route: readContextRoute(pathname, url.searchParams),
      policy,
    });
    const selection = resolution.current;
    if (!selection?.stationId || selection.allStations) {
      throw new AppError(
        'FORBIDDEN',
        'An authorised station context is required for cash summaries',
      );
    }
    return NextResponse.json(
      await getCashStationSummaryFromRequest(request, {
        selection,
      }),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
