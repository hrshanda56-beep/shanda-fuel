import { NextResponse } from 'next/server';
import { z } from 'zod';
import { establishStepUp, requireAuthenticatedActor } from '../../../../modules/identity';
import { resolveTenantExecutionContext } from '../../../../modules/tenancy/authority';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const runtime = 'nodejs';

const requestSchema = z.object({
  tenantId: z.string().uuid(),
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/),
});

function jsonResponse(body: unknown, status: number): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const POST = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const body = requestSchema.parse(await request.json());
    const context = await resolveTenantExecutionContext({
      request,
      requestedTenantId: body.tenantId,
    });
    const result = await establishStepUp({
      request,
      context,
      password: body.password,
      totpCode: body.totpCode,
    });
    return jsonResponse(
      {
        status: 'active',
        stepUpLevel: result.level,
        expiresAt: result.expiresAt,
      },
      200,
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
